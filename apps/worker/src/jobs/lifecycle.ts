import { countFunnel, isValidTimezone, zonedParts } from "@le/shared";
import { trialLimitEnforced } from "@le/billing";
import {
  adminNotifyEmail,
  approveStrategiesEmail,
  checkInEmail,
  connectLinkedInEmail,
  finishSetupEmail,
  launchCampaignEmail,
  tipsEmail,
  trialEndingEmail,
  welcomeEmail,
  type AdminEvent,
  type EmailMessage,
  type MarketingInput,
} from "@le/email";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { sendOnce, trySend, unsubscribeLinkFor, type SendOnceOutcome } from "../email.js";
import { resumeAnnouncements } from "./announcements.js";

/**
 * The email this product sends to its own users about using it.
 *
 * Three kinds, run hourly from the digest queue and again in the nightly sweep:
 *
 * - **The onboarding sequence**, keyed to what somebody has actually done
 *   rather than to the calendar. Each step has a moment it becomes due and a
 *   moment it goes stale, and it is skipped outright if the thing it asks for
 *   is already done — nobody is told to connect an account that is connected.
 * - **The operator's notifications**: every platform admin hears about a
 *   signup, a finished onboarding and a connected LinkedIn account.
 * - **The trial warning**, only while the trial limit is enforced, which it is
 *   not while the product is free.
 *
 * Every send goes through `sendOnce`, which claims `(user, step)` in
 * `email_sends` before it sends. That unique row is the whole of "never the
 * same email twice", and it is the only record this reads to decide.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The gap between two sequence emails to one person. A worker that was down
 * for a day comes back with two steps due at once, and two setup emails in the
 * same hour read as a machine catching up — because that is what it is.
 */
export const SEQUENCE_MIN_GAP_MS = 18 * HOUR;

/** Local hours a sequence email may land in. Nobody needs setup tips at 3am. */
export const SEQUENCE_SENDING_HOURS = { start: 8, end: 20 } as const;

/** What somebody has actually done, read from the database rather than inferred from time. */
export interface UserProgress {
  hasWorkspace: boolean;
  /** Owners set the workspace up; an invited rep only connects their own account. */
  isOwner: boolean;
  workspaceId: string | null;
  companyName: string | null;
  linkedInConnected: boolean;
  strategies: number;
  approvedStrategies: number;
  campaigns: number;
  launchedCampaigns: number;
}

export type SequenceKey =
  | "finish_setup"
  | "connect_linkedin"
  | "approve_strategies"
  | "launch_campaign"
  | "tips"
  | "check_in";

export interface SequenceStep {
  key: SequenceKey;
  /** How long after signup it becomes due. */
  atMs: number;
  /**
   * When it goes stale. Past this it is never sent: "connect LinkedIn" on day
   * nine is not a helpful reminder, it is a product that lost track of time —
   * and it is what keeps a deploy from mailing every existing user the whole
   * sequence on its first run.
   */
  untilMs: number;
  /** Whether it is still worth sending, given what they have done. */
  due(progress: UserProgress): boolean;
}

export const ONBOARDING_SEQUENCE: readonly SequenceStep[] = [
  {
    key: "finish_setup",
    atMs: 1 * HOUR,
    untilMs: 2 * DAY,
    due: (p) => !p.hasWorkspace,
  },
  {
    key: "connect_linkedin",
    atMs: 1 * DAY,
    untilMs: 4 * DAY,
    // Their own account, so an invited rep gets this one too.
    due: (p) => p.hasWorkspace && !p.linkedInConnected,
  },
  {
    key: "approve_strategies",
    atMs: 2 * DAY,
    untilMs: 5 * DAY,
    // Only once Sage has written something to approve.
    due: (p) => p.isOwner && p.strategies > 0 && p.approvedStrategies === 0,
  },
  {
    key: "launch_campaign",
    atMs: 3 * DAY,
    untilMs: 6 * DAY,
    // Launching needs both an approved strategy and an account to send from;
    // asking for it before then is asking for something they cannot do.
    due: (p) => p.isOwner && p.approvedStrategies > 0 && p.linkedInConnected && p.launchedCampaigns === 0,
  },
  {
    key: "tips",
    atMs: 5 * DAY,
    untilMs: 8 * DAY,
    due: (p) => p.hasWorkspace,
  },
  {
    key: "check_in",
    atMs: 7 * DAY,
    untilMs: 10 * DAY,
    due: () => true,
  },
];

/** The oldest account the sequence can still have anything to say to. */
const SEQUENCE_HORIZON_MS = Math.max(...ONBOARDING_SEQUENCE.map((s) => s.untilMs));

export function sequenceStepId(key: SequenceKey): string {
  return `onboarding.${key}`;
}

/**
 * Which step to send now, if any. Pure, so the rules can be tested without a
 * database: in order, the first step that is due by age, not stale, still
 * worth sending and not already sent — and nothing at all inside the minimum
 * gap or outside the person's own daytime.
 */
export function nextSequenceStep(input: {
  ageMs: number;
  progress: UserProgress;
  alreadySent: ReadonlySet<string>;
  lastLifecycleSentAt: number | null;
  now: number;
  localHour: number;
}): SequenceStep | null {
  if (input.lastLifecycleSentAt !== null && input.now - input.lastLifecycleSentAt < SEQUENCE_MIN_GAP_MS) return null;
  if (input.localHour < SEQUENCE_SENDING_HOURS.start || input.localHour >= SEQUENCE_SENDING_HOURS.end) return null;

  for (const step of ONBOARDING_SEQUENCE) {
    if (input.alreadySent.has(sequenceStepId(step.key))) continue;
    if (input.ageMs < step.atMs) return null;
    if (input.ageMs > step.untilMs) continue;
    if (!step.due(input.progress)) continue;
    return step;
  }
  return null;
}

/** The person's own hour, so a sequence email lands in their daytime. */
function localHour(now: Date, timezone: string | null | undefined): number {
  const zone = timezone && isValidTimezone(timezone) ? timezone : "UTC";
  return zonedParts(now, zone).hour;
}

export async function loadUserProgress(ctx: WorkerContext, userId: string): Promise<UserProgress> {
  const { db } = ctx;
  const head = { count: "exact" as const, head: true };

  const [{ data: memberships }, linked] = await Promise.all([
    db.from("memberships").select("workspace_id, role").eq("user_id", userId),
    db
      .from("linkedin_accounts")
      .select("id", head)
      .eq("user_id", userId)
      .not("status", "in", "(connecting,disconnected)"),
  ]);

  const rows = memberships ?? [];
  const home = rows.find((m) => m.role === "owner") ?? rows[0] ?? null;
  const progress: UserProgress = {
    hasWorkspace: Boolean(home),
    isOwner: home?.role === "owner",
    workspaceId: home?.workspace_id ?? null,
    companyName: null,
    linkedInConnected: (linked.count ?? 0) > 0,
    strategies: 0,
    approvedStrategies: 0,
    campaigns: 0,
    launchedCampaigns: 0,
  };
  if (!home) return progress;

  const ws = home.workspace_id;
  const [{ data: workspace }, strategies, approved, campaigns, launched] = await Promise.all([
    db.from("workspaces").select("name").eq("id", ws).maybeSingle(),
    db.from("customer_profiles").select("id", head).eq("workspace_id", ws),
    db.from("customer_profiles").select("id, approved_at", head).eq("workspace_id", ws).not("approved_at", "is", null),
    db.from("campaigns").select("id", head).eq("workspace_id", ws),
    db.from("campaigns").select("id, launched_at", head).eq("workspace_id", ws).not("launched_at", "is", null),
  ]);

  progress.companyName = workspace?.name ?? null;
  progress.strategies = strategies.count ?? 0;
  progress.approvedStrategies = approved.count ?? 0;
  progress.campaigns = campaigns.count ?? 0;
  progress.launchedCampaigns = launched.count ?? 0;
  return progress;
}

/** What is done, said as things that exist — the check-in credits before it asks. */
function doneInWords(p: UserProgress): string[] {
  return [
    p.hasWorkspace ? "your workspace is set up" : null,
    p.approvedStrategies > 0 ? "a strategy is approved" : null,
    p.linkedInConnected ? "LinkedIn is connected" : null,
    p.launchedCampaigns > 0 ? "your first campaign is live" : null,
  ].filter((x): x is string => Boolean(x));
}

export function buildSequenceEmail(key: SequenceKey, base: MarketingInput, progress: UserProgress): EmailMessage {
  switch (key) {
    case "finish_setup":
      return finishSetupEmail(base);
    case "connect_linkedin":
      return connectLinkedInEmail(base);
    case "approve_strategies":
      return approveStrategiesEmail({ ...base, companyName: progress.companyName, strategies: progress.strategies });
    case "launch_campaign":
      return launchCampaignEmail({ ...base, hasCampaign: progress.campaigns > 0 });
    case "tips":
      return tipsEmail(base);
    case "check_in":
      return checkInEmail({ ...base, done: doneInWords(progress) });
  }
}

/**
 * One pass of the onboarding sequence over everybody young enough to have a
 * step left. At most one email per person per pass.
 */
export async function runOnboardingSequence(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;

  const since = new Date(now.getTime() - SEQUENCE_HORIZON_MS).toISOString();
  const { data: users, error } = await db
    .from("profiles")
    .select("id, email, full_name, timezone, created_at, marketing_opt_out_at")
    .gte("created_at", since);
  if (error) throw new Error(`could not read recent users: ${error.message}`);

  let sent = 0;
  for (const user of users ?? []) {
    try {
      if (!user.email || user.marketing_opt_out_at) continue;

      // No signed link, no marketing email: a footer whose unsubscribe does
      // not work is worse than not writing at all.
      const unsubscribeUrl = unsubscribeLinkFor(ctx.env, user.id);
      if (!unsubscribeUrl) continue;

      const { data: sends } = await db
        .from("email_sends")
        .select("step, kind, sent_at, created_at")
        .eq("user_id", user.id);
      const alreadySent = new Set((sends ?? []).map((s) => s.step));

      const progress = await loadUserProgress(ctx, user.id);

      // Somebody we have never welcomed and who never made a workspace may
      // never have confirmed the address — a signup form will take anyone's.
      // The welcome is only sent once the address has been proved by a
      // session, so its row is the evidence this person is who they say.
      if (!alreadySent.has("welcome") && !progress.hasWorkspace) continue;

      const lifecycleTimes = (sends ?? [])
        .filter((s) => s.kind === "lifecycle")
        .map((s) => Date.parse(s.sent_at ?? s.created_at))
        .filter(Number.isFinite);
      const lastLifecycleSentAt = lifecycleTimes.length ? Math.max(...lifecycleTimes) : null;

      const step = nextSequenceStep({
        ageMs: now.getTime() - Date.parse(user.created_at),
        progress,
        alreadySent,
        lastLifecycleSentAt,
        now: now.getTime(),
        localHour: localHour(now, user.timezone),
      });
      if (!step) continue;

      const message = buildSequenceEmail(
        step.key,
        {
          to: user.email,
          repName: user.full_name,
          appUrl: ctx.env.APP_URL,
          unsubscribeUrl,
          postalAddress: ctx.env.EMAIL_POSTAL_ADDRESS ?? null,
        },
        progress,
      );
      const outcome = await sendOnce(db, ctx.email, {
        userId: user.id,
        step: sequenceStepId(step.key),
        kind: "lifecycle",
        message,
      });
      if (outcome === "sent") sent += 1;
    } catch (err) {
      // One person's bad data must not stop everyone else's email.
      console.error("onboarding email failed", user.id, err);
    }
  }
  return sent;
}

/* ------------------------------------------------------- the operators */

/**
 * Everybody who should hear about a new customer: every platform admin, plus
 * whatever `ADMIN_NOTIFY_EMAILS` names. Lower-cased and de-duplicated, so an
 * admin who is also on the list is told once.
 */
export async function adminRecipients(ctx: WorkerContext): Promise<string[]> {
  const { db } = ctx;
  const found = new Set<string>();

  const { data: admins } = await db.from("platform_admins").select("user_id");
  const ids = (admins ?? []).map((a) => a.user_id);
  if (ids.length) {
    const { data: profiles } = await db.from("profiles").select("id, email").in("id", ids);
    for (const p of profiles ?? []) if (p.email) found.add(p.email.trim().toLowerCase());
  }

  for (const raw of (ctx.env.ADMIN_NOTIFY_EMAILS ?? "").split(",")) {
    const address = raw.trim().toLowerCase();
    if (address.includes("@")) found.add(address);
  }
  return [...found].sort();
}

/**
 * Tells every operator that something happened to one user, once per
 * operator per event, ever.
 */
export async function notifyAdmins(
  ctx: WorkerContext,
  event: AdminEvent,
  userId: string,
  at: Date,
): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;

  const recipients = await adminRecipients(ctx);
  if (!recipients.length) return 0;

  const { data: profile } = await db.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
  if (!profile?.email) return 0;

  const { data: membership } = await db
    .from("memberships")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: workspace } = membership
    ? await db.from("workspaces").select("id, name").eq("id", membership.workspace_id).maybeSingle()
    : { data: null };

  let sent = 0;
  for (const to of recipients) {
    const outcome = await sendOnce(db, ctx.email, {
      userId,
      step: `admin.${event}.${to}`,
      kind: "admin",
      recipient: to,
      message: adminNotifyEmail({
        to,
        appUrl: ctx.env.APP_URL,
        event,
        name: profile.full_name,
        email: profile.email,
        company: workspace?.name ?? null,
        at,
        workspaceId: workspace?.id ?? null,
      }),
    });
    if (outcome === "sent") sent += 1;
  }
  return sent;
}

/** How far back the sweep looks for a milestone nobody was told about. */
const MILESTONE_WINDOW_MS = 2 * DAY;

/**
 * The backstop for the operator's notifications.
 *
 * Signup and onboarding notify on the request that caused them; a connected
 * LinkedIn account is noticed here, because accounts are bound on three
 * separate paths and none of them should grow an email side effect. Each
 * milestone is only looked for inside a recent window, so the first run after
 * a deploy does not announce every customer the deployment has ever had.
 */
export async function notifyAdminsOfMilestones(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;
  const since = new Date(now.getTime() - MILESTONE_WINDOW_MS).toISOString();
  let sent = 0;

  const { data: signups } = await db.from("profiles").select("id, created_at").gte("created_at", since);
  for (const user of signups ?? []) {
    sent += await notifyAdmins(ctx, "signup", user.id, new Date(user.created_at));
  }

  // No separate "finished setup" note: operators asked for one email per
  // person, sent the moment they sign up, not a second one an hour later.

  const { data: accounts } = await db
    .from("linkedin_accounts")
    .select("user_id, connected_at, status")
    .gte("connected_at", since)
    .not("status", "in", "(connecting,disconnected)");
  for (const account of accounts ?? []) {
    if (!account.connected_at) continue;
    sent += await notifyAdmins(ctx, "linkedin_connected", account.user_id, new Date(account.connected_at));
  }
  return sent;
}

/**
 * The emails that belong to the moment somebody arrives: their welcome, and
 * the operators' note that they did. Called by the web app after signup, after
 * an email confirmation and after onboarding; every part is once-only, so
 * calling it from all three is the point rather than a risk.
 */
export async function sendAccountEmails(
  ctx: WorkerContext,
  userId: string,
  now: Date = new Date(),
): Promise<{ welcome: SendOnceOutcome | "skipped"; admins: number }> {
  const { db } = ctx;
  const { data: profile } = await db
    .from("profiles")
    .select("id, email, full_name, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.email) return { welcome: "skipped", admins: 0 };

  const welcome = await sendOnce(db, ctx.email, {
    userId,
    step: "welcome",
    kind: "transactional",
    message: welcomeEmail({ to: profile.email, repName: profile.full_name, appUrl: ctx.env.APP_URL }),
  });

  // One operator note per person, at signup. Finishing setup used to send a
  // second, near-identical one — two emails per customer read as a fault.
  const admins = await notifyAdmins(ctx, "signup", userId, new Date(profile.created_at ?? now));
  return { welcome, admins };
}

/* ------------------------------------------------------------ the run */

/**
 * Everything above, plus the trial warning. Each part is independent: one
 * throwing must not stop the others, exactly as the nightly sweep's steps.
 */
export async function runLifecycleEmails(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  if (!ctx.email) return 0;
  let sent = 0;

  const parts: [string, () => Promise<number>][] = [
    ["onboarding-sequence", () => runOnboardingSequence(ctx, now)],
    ["admin-milestones", () => notifyAdminsOfMilestones(ctx, now)],
    ["announcements", () => resumeAnnouncements(ctx, now)],
    ["trial-warnings", () => runTrialWarnings(ctx, now)],
  ];
  for (const [name, run] of parts) {
    try {
      sent += await run();
    } catch (error) {
      console.error(`lifecycle email step failed: ${name}`, error);
    }
  }
  return sent;
}

/* ------------------------------------------------------ trial warnings */

const TRIAL_WARNING_DAYS = [3, 1];

type WorkspaceRow = {
  id: string;
  name: string;
  plan: string;
  trial_ends_at: string | null;
  subscription_status: string | null;
  created_at: string;
};

async function runTrialWarnings(ctx: WorkerContext, now: Date): Promise<number> {
  // No "your trial ends in 3 days" while the trial does not end. The email
  // would be a threat the product does not carry out — and the next one, when
  // it does, would be read as another false alarm.
  if (!trialLimitEnforced(process.env.TRIAL_LIMIT_ENFORCED)) return 0;

  const { data: workspaces } = await ctx.db
    .from("workspaces")
    .select("id, name, plan, trial_ends_at, subscription_status, created_at");
  let sent = 0;
  for (const workspace of workspaces ?? []) {
    try {
      sent += await maybeTrialWarning(ctx, workspace, now);
    } catch (error) {
      console.error("trial warning failed", workspace.id, error);
    }
  }
  return sent;
}

async function maybeTrialWarning(ctx: WorkerContext, workspace: WorkspaceRow, now: Date): Promise<number> {
  if (workspace.subscription_status === "active" || !workspace.trial_ends_at) return 0;

  const daysLeft = Math.ceil((Date.parse(workspace.trial_ends_at) - now.getTime()) / 86_400_000);
  if (!TRIAL_WARNING_DAYS.includes(daysLeft)) return 0;

  const eventName = `trial.warned.${daysLeft}`;
  const { data: already } = await ctx.db
    .from("events")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("name", eventName)
    .limit(1)
    .maybeSingle();
  if (already) return 0;

  // Two queries rather than an embedded `profiles(...)` join: the same shape
  // digest.ts uses, and the only one the fake database can answer honestly.
  const { data: owner } = await ctx.db
    .from("memberships")
    .select("user_id")
    .eq("workspace_id", workspace.id)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (!owner) return 0;
  const { data: profile } = await ctx.db
    .from("profiles")
    .select("email, full_name")
    .eq("id", owner.user_id)
    .maybeSingle();
  if (!profile?.email) return 0;

  const { data: rows } = await ctx.db
    .from("campaign_prospects")
    .select("status, invited_at, accepted_at, replied_at")
    .eq("workspace_id", workspace.id);
  const counts = countFunnel(rows ?? []);

  const ok = await trySend(
    ctx.email,
    trialEndingEmail({
      to: profile.email,
      repName: profile.full_name,
      appUrl: ctx.env.APP_URL,
      daysLeft,
      invited: counts.invited,
      accepted: counts.accepted,
      meetings: counts.meetings,
    }),
  );
  if (!ok) return 0;

  await recordEvent(ctx.db, { workspaceId: workspace.id, name: eventName, subjectType: "workspace", subjectId: workspace.id });
  return 1;
}
