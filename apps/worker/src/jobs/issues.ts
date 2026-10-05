import {
  BOOT_BEAT,
  MAINTENANCE_BEAT,
  MESSAGE_WEBHOOK_BEAT,
  PACING_LAST_FAILURE,
  PACING_LOOP,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { OBSERVED_ACCOUNTS_BEAT } from "../accounts.js";
import { WEBHOOKS_BEAT } from "../webhooks.js";
import { INBOUND_POLL_BEAT } from "./inbound-poll.js";

/**
 * Everything wrong across the deployment, in one list, for the operator.
 *
 * Each fault this product has had was visible somewhere — a heartbeat row, an
 * event, a status column — and on no screen anybody read: a webhook refusing
 * every reply, a rep stuck at "connecting", a customer who signed up twice, a
 * campaign built and never launched, an account LinkedIn was throttling. They
 * were found by somebody running SQL after a customer complained. This reads
 * the same rows every hour-by-hour screen does and says, per workspace and per
 * person, what is wrong and how long it has been wrong.
 *
 * Read-only, operator-only, and counts rather than contents: it never reads a
 * message, a conversation or a prospect's details (rule 15).
 */
export type IssueSeverity = "critical" | "warning" | "info";
export type IssueArea = "Platform" | "Replies" | "LinkedIn" | "Campaigns" | "Members" | "Email" | "Support";

export interface Issue {
  id: string;
  severity: IssueSeverity;
  area: IssueArea;
  title: string;
  detail: string;
  workspaceId?: string | null;
  workspace?: string | null;
  person?: string | null;
  since?: string | null;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

type Beat = { name: string; beat_at: string; detail: unknown };

function detailOf(beat: Beat | undefined): Record<string, unknown> {
  return beat?.detail && typeof beat.detail === "object" ? (beat.detail as Record<string, unknown>) : {};
}

function age(at: string | null | undefined, now: Date): number {
  if (!at) return Infinity;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? now.getTime() - ms : Infinity;
}

export async function collectIssues(ctx: WorkerContext, now: Date = new Date()): Promise<Issue[]> {
  const { db } = ctx;
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);

  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const [
    { data: workspaces },
    { data: memberships },
    { data: profiles },
    { data: accounts },
    { data: campaigns },
    { data: campaignProspects },
    { data: strategies },
    { data: beats },
    { data: events },
    { data: tickets },
    { data: stuckEmails },
  ] = await Promise.all([
    db.from("workspaces").select("id, name, created_at"),
    db.from("memberships").select("workspace_id, user_id, role"),
    db.from("profiles").select("id, email, full_name, created_at"),
    db
      .from("linkedin_accounts")
      .select(
        "id, workspace_id, user_id, status, status_detail, provider_account_id, invites_paused_until, invites_paused_reason, created_at",
      ),
    db.from("campaigns").select("id, workspace_id, name, status, launched_at, linkedin_account_id, created_at, updated_at"),
    db.from("campaign_prospects").select("campaign_id, status").limit(20000),
    db.from("customer_profiles").select("workspace_id, approved_at, do_not_pursue, created_at"),
    db.from("worker_heartbeats").select("name, beat_at, detail"),
    db
      .from("events")
      .select("workspace_id, name, actor_user_id, subject_id, payload, created_at")
      .in("name", [
        "linkedin.connect.failed",
        "campaign.notes_missing",
        "targeting.stopped",
        "invite.throttled",
        "linkedin.account.reauth_required",
      ])
      .gte("created_at", weekAgo),
    db.from("support_tickets").select("id, workspace_id, subject, status, created_at"),
    db.from("email_sends").select("user_id, step, status, created_at").eq("status", "claimed"),
  ]);

  const workspaceName = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const person = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name ? `${p.full_name} (${p.email ?? "no email"})` : (p.email ?? p.id)]),
  );
  const beat = (name: string) => (beats ?? []).find((b) => b.name === name) as Beat | undefined;
  const at = (workspaceId: string | null | undefined) => ({
    workspaceId: workspaceId ?? null,
    workspace: workspaceId ? (workspaceName.get(workspaceId) ?? null) : null,
  });

  // ── Platform ────────────────────────────────────────────────────────────
  const boot = beat(BOOT_BEAT);
  if (!boot) {
    add({ id: "platform:boot", severity: "warning", area: "Platform", title: "The worker has not reported starting", detail: "No boot stamp. Either the worker is down or its newest build has not deployed." });
  } else if (detailOf(boot).queueReachable === false) {
    add({ id: "platform:queue", severity: "critical", area: "Platform", title: "The worker cannot reach its queue", detail: "Nothing launched will be picked up. Check REDIS_URL on the worker.", since: boot.beat_at });
  }

  const pacing = beat(PACING_LOOP);
  if (age(pacing?.beat_at, now) > 15 * 60_000) {
    add({ id: "platform:pacing", severity: "critical", area: "Platform", title: "The sending loop has stopped", detail: pacing ? `Last ran ${pacing.beat_at}; it should run every five minutes. Nothing is being sent.` : "It has never reported. Nothing is being sent.", since: pacing?.beat_at ?? null });
  }
  const pacingFailure = beat(PACING_LAST_FAILURE);
  if (pacingFailure && age(pacingFailure.beat_at, now) < DAY) {
    add({ id: "platform:pacing-failure", severity: "warning", area: "Platform", title: "The sending loop threw in the last day", detail: String(detailOf(pacingFailure).failed ?? detailOf(pacingFailure).reason ?? "No reason recorded."), since: pacingFailure.beat_at });
  }

  const nightly = beat(MAINTENANCE_BEAT);
  const nightlyFailed = Array.isArray(detailOf(nightly).failed) ? (detailOf(nightly).failed as string[]) : [];
  if (!nightly || age(nightly.beat_at, now) > 26 * HOUR) {
    add({ id: "platform:maintenance", severity: "warning", area: "Platform", title: "Nightly housekeeping has not run", detail: nightly ? `Last finished ${nightly.beat_at}.` : "It has never reported.", since: nightly?.beat_at ?? null });
  } else if (nightlyFailed.length) {
    add({ id: "platform:maintenance-steps", severity: "warning", area: "Platform", title: "Nightly housekeeping had failing steps", detail: nightlyFailed.join(", "), since: nightly.beat_at });
  }

  // ── Replies ─────────────────────────────────────────────────────────────
  const registration = beat(WEBHOOKS_BEAT);
  const registrationDetail = detailOf(registration);
  if (!registration) {
    add({ id: "replies:registration", severity: "warning", area: "Replies", title: "The worker has not registered its webhooks", detail: "Replies rely on the 15-minute poll until it does. Check UNIPILE_WEBHOOK_SECRET and WORKER_URL on the worker." });
  } else if (registrationDetail.ok === false) {
    add({ id: "replies:registration", severity: "critical", area: "Replies", title: "Registering the webhooks failed", detail: String(registrationDetail.reason ?? "No reason recorded."), since: registration.beat_at });
  }

  const delivery = beat(MESSAGE_WEBHOOK_BEAT);
  const deliveryDetail = detailOf(delivery);
  if (delivery && deliveryDetail.ok === false) {
    const repaired =
      registrationDetail.ok === true && registration && Date.parse(registration.beat_at) > Date.parse(delivery.beat_at);
    if (!repaired) {
      add({
        id: "replies:refused",
        severity: "critical",
        area: "Replies",
        title: "Reply deliveries are being refused",
        detail:
          deliveryDetail.hadSignature === false
            ? "Deliveries arrive with no credential. The webhook needs the Unipile-Auth header set to UNIPILE_WEBHOOK_SECRET; restarting the worker re-registers it."
            : `A credential arrived and did not verify (${String(deliveryDetail.reason ?? "no reason")}).`,
        since: delivery.beat_at,
      });
    }
  }

  const poll = beat(INBOUND_POLL_BEAT);
  const pollDetail = detailOf(poll);
  if (poll && age(poll.beat_at, now) > HOUR) {
    add({ id: "replies:poll-stale", severity: "warning", area: "Replies", title: "Reply polling has stopped", detail: `Last ran ${poll.beat_at}; it should run every 15 minutes.`, since: poll.beat_at });
  }
  for (const failure of Array.isArray(pollDetail.failed) ? (pollDetail.failed as Array<{ account: string; error: string }>) : []) {
    const account = (accounts ?? []).find((a) => a.id === failure.account);
    add({
      id: `replies:poll-failed:${failure.account}`,
      severity: "warning",
      area: "Replies",
      title: "Could not check this account for replies",
      detail: failure.error,
      ...at(account?.workspace_id),
      person: account ? (person.get(account.user_id) ?? null) : null,
      since: poll?.beat_at ?? null,
    });
  }

  // ── LinkedIn ────────────────────────────────────────────────────────────
  for (const account of accounts ?? []) {
    const who = person.get(account.user_id) ?? null;
    if (!account.provider_account_id) {
      if (age(account.created_at, now) > HOUR) {
        add({
          id: `linkedin:unconnected:${account.id}`,
          severity: "warning",
          area: "LinkedIn",
          title: account.status === "disconnected" ? "LinkedIn sign-in failed and was not retried" : "LinkedIn sign-in started and never finished",
          detail: account.status_detail ?? "No account is attached, so nothing can send for this person.",
          ...at(account.workspace_id),
          person: who,
          since: account.created_at,
        });
      }
      continue;
    }
    if (!["active", "warning"].includes(account.status)) {
      add({
        id: `linkedin:status:${account.id}`,
        severity: account.status === "paused" ? "info" : "critical",
        area: "LinkedIn",
        title: `LinkedIn account is ${account.status.replaceAll("_", " ")}`,
        detail: account.status_detail ?? "Nothing sends from this account until it is fixed.",
        ...at(account.workspace_id),
        person: who,
      });
    }
    if (account.invites_paused_until && Date.parse(account.invites_paused_until) > now.getTime()) {
      add({
        id: `linkedin:throttled:${account.id}`,
        severity: "warning",
        area: "LinkedIn",
        title: "LinkedIn is refusing invitations from this account",
        detail: `${account.invites_paused_reason ?? "Throttled."} Invitations resume after ${account.invites_paused_until}.`,
        ...at(account.workspace_id),
        person: who,
      });
    }
  }

  const observed = detailOf(beat(OBSERVED_ACCOUNTS_BEAT));
  const held = new Set((accounts ?? []).map((a) => a.provider_account_id).filter(Boolean));
  for (const providerAccount of Array.isArray(observed.accounts)
    ? (observed.accounts as Array<{ providerAccountId: string; reference?: string }>)
    : []) {
    if (!held.has(providerAccount.providerAccountId)) {
      add({
        id: `linkedin:orphan:${providerAccount.providerAccountId}`,
        severity: "info",
        area: "LinkedIn",
        title: "The provider holds an account nobody here owns",
        detail: `Account ${providerAccount.providerAccountId}${providerAccount.reference ? ` labelled "${providerAccount.reference}"` : ""} is connected at the provider and attached to no member. It may be a duplicate connection worth deleting there.`,
      });
    }
  }

  const failedSignIns = new Map<string, { count: number; last: string; workspaceId: string }>();
  for (const event of (events ?? []).filter((e) => e.name === "linkedin.connect.failed")) {
    const key = event.actor_user_id ?? event.subject_id ?? "unknown";
    const prev = failedSignIns.get(key);
    failedSignIns.set(key, {
      count: (prev?.count ?? 0) + 1,
      last: prev && prev.last > event.created_at ? prev.last : event.created_at,
      workspaceId: event.workspace_id,
    });
  }
  for (const [userId, info] of failedSignIns) {
    add({
      id: `linkedin:signin-failed:${userId}`,
      severity: "info",
      area: "LinkedIn",
      title: `LinkedIn refused ${info.count} sign-in attempt${info.count === 1 ? "" : "s"} this week`,
      detail: "Usually a Google/Apple-created LinkedIn account with no password, a verification code not entered, or a mistyped password.",
      ...at(info.workspaceId),
      person: person.get(userId) ?? null,
      since: info.last,
    });
  }

  // ── Members ─────────────────────────────────────────────────────────────
  const memberIds = new Set((memberships ?? []).map((m) => m.user_id));
  for (const profile of profiles ?? []) {
    if (!memberIds.has(profile.id) && age(profile.created_at, now) > HOUR) {
      add({
        id: `members:no-workspace:${profile.id}`,
        severity: "warning",
        area: "Members",
        title: "Signed up but never finished setup",
        detail: "This person has an account and no workspace, so they see only the setup form.",
        person: person.get(profile.id) ?? null,
        since: profile.created_at,
      });
    }
  }

  // Two accounts that look like one person: the same name, or the same
  // mailbox name at two providers (pm.me and proton.me are one inbox).
  const byKey = new Map<string, string[]>();
  for (const profile of profiles ?? []) {
    const keys = new Set<string>();
    if (profile.full_name?.trim()) keys.add(`name:${profile.full_name.trim().toLowerCase()}`);
    const local = profile.email?.split("@")[0]?.toLowerCase();
    if (local && local.length >= 5) keys.add(`local:${local}`);
    for (const key of keys) byKey.set(key, [...(byKey.get(key) ?? []), profile.id]);
  }
  const reported = new Set<string>();
  for (const ids of byKey.values()) {
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    const key = unique.sort().join(",");
    if (reported.has(key)) continue;
    reported.add(key);
    add({
      id: `members:duplicate:${key}`,
      severity: "warning",
      area: "Members",
      title: "One person may have two accounts",
      detail: `${unique.map((id) => person.get(id) ?? id).join(" and ")}. Whichever they sign in with decides what they see — an empty second account reads as "nothing is connected".`,
    });
  }

  for (const workspace of workspaces ?? []) {
    if (age(workspace.created_at, now) < DAY) continue;
    const connected = (accounts ?? []).some((a) => a.workspace_id === workspace.id && a.provider_account_id);
    if (!connected) {
      add({
        id: `members:no-linkedin:${workspace.id}`,
        severity: "warning",
        area: "Members",
        title: "LinkedIn never connected",
        detail: "Nothing can be searched or sent for this workspace until somebody connects an account.",
        ...at(workspace.id),
        since: workspace.created_at,
      });
    }
    const own = (strategies ?? []).filter((s) => s.workspace_id === workspace.id && !s.do_not_pursue);
    if (own.length && !own.some((s) => s.approved_at)) {
      const oldest = own.map((s) => s.created_at).sort()[0] ?? null;
      if (age(oldest, now) > 2 * DAY) {
        add({
          id: `members:unapproved:${workspace.id}`,
          severity: "info",
          area: "Members",
          title: `${own.length} strateg${own.length === 1 ? "y" : "ies"} waiting for approval`,
          detail: "Nothing is searched for until one is approved.",
          ...at(workspace.id),
          since: oldest,
        });
      }
    }
  }

  // ── Campaigns ───────────────────────────────────────────────────────────
  const counts = new Map<string, Record<string, number>>();
  for (const row of campaignProspects ?? []) {
    const c = counts.get(row.campaign_id) ?? {};
    c[row.status] = (c[row.status] ?? 0) + 1;
    counts.set(row.campaign_id, c);
  }
  for (const campaign of campaigns ?? []) {
    const c = counts.get(campaign.id) ?? {};
    const account = (accounts ?? []).find((a) => a.id === campaign.linkedin_account_id);
    const base = { ...at(campaign.workspace_id) };
    if (campaign.status === "running" && (!account || !["active", "warning"].includes(account.status) || !account.provider_account_id)) {
      add({ id: `campaigns:running-dead:${campaign.id}`, severity: "critical", area: "Campaigns", title: `"${campaign.name}" is running on an account that cannot send`, detail: "The campaign says running and nothing will leave until its LinkedIn account is fixed.", ...base });
    }
    const waiting = (c.accepted ?? 0) + (c.messaged_1 ?? 0) + (c.messaged_2 ?? 0);
    if (campaign.status === "paused" && waiting > 0) {
      add({ id: `campaigns:paused-waiting:${campaign.id}`, severity: "warning", area: "Campaigns", title: `"${campaign.name}" is paused with ${waiting} accepted ${waiting === 1 ? "person" : "people"} mid-conversation`, detail: "People who accepted get no follow-up while it is paused.", ...base, since: campaign.updated_at });
    }
    if (campaign.status === "draft" && (c.queued ?? 0) > 0 && age(campaign.created_at, now) > DAY) {
      add({ id: `campaigns:never-launched:${campaign.id}`, severity: "info", area: "Campaigns", title: `"${campaign.name}" was built and never launched`, detail: `${c.queued} people are queued and waiting for review.`, ...base, since: campaign.created_at });
    }
    if ((c.failed ?? 0) > 0) {
      add({ id: `campaigns:failed:${campaign.id}`, severity: "warning", area: "Campaigns", title: `${c.failed} failed in "${campaign.name}"`, detail: "Rows marked failed are not retried; read the campaign's failures.", ...base });
    }
  }
  for (const event of (events ?? []).filter((e) => e.name === "targeting.stopped")) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    add({ id: `campaigns:targeting:${event.workspace_id}:${event.created_at}`, severity: "warning", area: "Campaigns", title: "Finding prospects stopped", detail: String(payload.reason ?? "No reason recorded."), ...at(event.workspace_id), since: event.created_at });
  }
  for (const event of (events ?? []).filter((e) => e.name === "campaign.notes_missing")) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    add({ id: `campaigns:notes:${event.subject_id ?? event.created_at}`, severity: "info", area: "Campaigns", title: "Some invitation notes fell back to the template", detail: `${String(payload.missing ?? "Some")} of ${String(payload.prospects ?? "?")} notes were not personalised.`, ...at(event.workspace_id), since: event.created_at });
  }

  // ── Email ───────────────────────────────────────────────────────────────
  if (ctx.env.EMAIL_PROVIDER !== "resend") {
    add({ id: "email:off", severity: "warning", area: "Email", title: "Emails are switched off", detail: `EMAIL_PROVIDER is "${ctx.env.EMAIL_PROVIDER ?? "off"}". Welcome, onboarding, alerts and updates are not being sent. Set it to resend with RESEND_API_KEY and EMAIL_FROM.` });
  } else if (!ctx.env.RESEND_API_KEY || !ctx.env.EMAIL_FROM) {
    add({ id: "email:incomplete", severity: "critical", area: "Email", title: "Email is half configured", detail: "EMAIL_PROVIDER is resend but RESEND_API_KEY or EMAIL_FROM is missing." });
  }
  if (!ctx.env.INTERNAL_API_SECRET) {
    add({ id: "email:no-unsubscribe", severity: "warning", area: "Email", title: "Onboarding and update emails cannot be sent", detail: "INTERNAL_API_SECRET is missing, so no unsubscribe link can be signed." });
  }
  const stuck = (stuckEmails ?? []).filter((e) => age(e.created_at, now) > 30 * 60_000);
  if (stuck.length) {
    add({ id: "email:stuck", severity: "warning", area: "Email", title: `${stuck.length} email${stuck.length === 1 ? "" : "s"} claimed and never sent`, detail: `A run died between claiming and sending: ${[...new Set(stuck.map((e) => e.step))].slice(0, 5).join(", ")}.`, since: stuck.map((e) => e.created_at).sort()[0] ?? null });
  }

  // ── Support ─────────────────────────────────────────────────────────────
  for (const ticket of (tickets ?? []).filter((t) => t.status === "open")) {
    add({ id: `support:${ticket.id}`, severity: "warning", area: "Support", title: `Open ticket: ${ticket.subject}`, detail: "Waiting for an answer in Needs attention.", ...at(ticket.workspace_id), since: ticket.created_at });
  }

  const rank: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.area.localeCompare(b.area));
}
