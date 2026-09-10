import { countFunnel, nextStep, ONBOARDING_STEPS, type OnboardingState } from "@le/shared";
import { onboardingNudgeEmail, trialEndingEmail } from "@le/email";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { trySend } from "../email.js";

/**
 * The lifecycle emails: a nudge when a workspace stalls, and a warning before a
 * trial ends.
 *
 * Two rules govern all of it. A step is nudged once and never again, recorded
 * as an event, because the difference between a helpful reminder and spam is
 * entirely repetition. And nothing is sent on the first day — someone who
 * signed up an hour ago has not stalled, they are still reading.
 */

const GRACE_DAYS = 2;
const TRIAL_WARNING_DAYS = [3, 1];

export async function runLifecycleEmails(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;

  const { data: workspaces } = await db
    .from("workspaces")
    .select("id, name, plan, trial_ends_at, subscription_status, created_at");
  if (!workspaces?.length) return 0;

  let sent = 0;
  for (const workspace of workspaces) {
    try {
      sent += await forWorkspace(ctx, workspace, now);
    } catch (error) {
      // One workspace's bad data must not stop everyone else's email.
      console.error("lifecycle email failed", workspace.id, error);
    }
  }
  return sent;
}

type WorkspaceRow = {
  id: string;
  name: string;
  plan: string;
  trial_ends_at: string | null;
  subscription_status: string | null;
  created_at: string;
};

async function forWorkspace(ctx: WorkerContext, workspace: WorkspaceRow, now: Date): Promise<number> {
  const { db } = ctx;

  const daysIn = Math.floor((now.getTime() - Date.parse(workspace.created_at)) / 86_400_000);
  if (daysIn < GRACE_DAYS) return 0;

  // Two queries rather than an embedded `profiles(...)` join: the same shape
  // digest.ts uses, and the only one the fake database can answer honestly.
  const { data: owner } = await db
    .from("memberships")
    .select("user_id")
    .eq("workspace_id", workspace.id)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (!owner) return 0;

  const { data: profile } = await db
    .from("profiles")
    .select("email, full_name")
    .eq("id", owner.user_id)
    .maybeSingle();
  if (!profile?.email) return 0;

  let sent = 0;
  sent += await maybeNudge(ctx, workspace, profile, daysIn);
  sent += await maybeTrialWarning(ctx, workspace, profile, now);
  return sent;
}

/**
 * Reads the same state the dashboard checklist reads.
 *
 * Written out one query at a time rather than through a clever helper: each of
 * these has a different filter, and a generic counter that takes a callback to
 * apply it ends up more casts than code.
 */
export async function loadOnboardingState(ctx: WorkerContext, workspaceId: string): Promise<OnboardingState> {
  const { db } = ctx;
  const head = { count: "exact" as const, head: true };

  // Written out one query at a time. A generic counter would need each filter
  // passed as a callback, and the typed builder narrows its columns to whatever
  // was selected — so the clever version is more casts than code.
  const [business, approved, account, campaign, launched, calendar, knowledge] = await Promise.all([
    db.from("business_profiles").select("id", head).eq("workspace_id", workspaceId),
    db
      .from("customer_profiles")
      .select("id, approved_at", head)
      .eq("workspace_id", workspaceId)
      .not("approved_at", "is", null),
    db
      .from("linkedin_accounts")
      .select("id, status", head)
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    db.from("campaigns").select("id", head).eq("workspace_id", workspaceId),
    db
      .from("campaigns")
      .select("id, launched_at", head)
      .eq("workspace_id", workspaceId)
      .not("launched_at", "is", null),
    db
      .from("integrations")
      .select("id, kind", head)
      .eq("workspace_id", workspaceId)
      .in("kind", ["google_calendar", "microsoft_calendar"]),
    db.from("knowledge_documents").select("id", head).eq("workspace_id", workspaceId),
  ]);

  const any = (result: { count: number | null }) => (result.count ?? 0) > 0;

  return {
    hasBusinessProfile: any(business),
    hasApprovedProfile: any(approved),
    hasLinkedInAccount: any(account),
    hasCampaign: any(campaign),
    hasLaunchedCampaign: any(launched),
    hasCalendar: any(calendar),
    hasKnowledge: any(knowledge),
  };
}

async function maybeNudge(
  ctx: WorkerContext,
  workspace: WorkspaceRow,
  profile: { email: string; full_name: string | null },
  daysIn: number,
): Promise<number> {
  const state = await loadOnboardingState(ctx, workspace.id);
  const step = nextStep(state);
  if (!step) return 0;

  // Once per step, ever. The event is the record; there is no second reminder,
  // because a reminder people learn to ignore costs more than it earns.
  const eventName = `onboarding.nudged.${step.key}`;
  const { data: already } = await ctx.db
    .from("events")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("name", eventName)
    .limit(1)
    .maybeSingle();
  if (already) return 0;

  // Named as things that exist ("your LinkedIn account"), not as instructions.
  // "tell us what you sell is done" is what the label field would have said.
  const completed = ONBOARDING_STEPS.filter((s) => state[s.key]).map((s) => s.done);

  const ok = await trySend(
    ctx.email,
    onboardingNudgeEmail({
      to: profile.email,
      repName: profile.full_name,
      appUrl: ctx.env.APP_URL,
      step,
      daysIn,
      completed,
    }),
  );
  if (!ok) return 0;

  await recordEvent(ctx.db, { workspaceId: workspace.id, name: eventName, subjectType: "workspace", subjectId: workspace.id });
  return 1;
}

async function maybeTrialWarning(
  ctx: WorkerContext,
  workspace: WorkspaceRow,
  profile: { email: string; full_name: string | null },
  now: Date,
): Promise<number> {
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
