import {
  BOOT_BEAT,
  MAINTENANCE_BEAT,
  MESSAGE_WEBHOOK_BEAT,
  PACING_LAST_FAILURE,
  PACING_LOOP,
  standingWebhookRefusal,
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
export type IssueArea = "Platform" | "Jobs" | "Replies" | "Unipile" | "AI" | "Campaigns" | "Email" | "Support";

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

/** The queues, asked how many jobs failed. Optional so the collector runs without Redis in tests. */
export type QueueCounts = Record<string, { failed: number; reasons: string[] }>;

/** How far back a failed job still counts as a fault rather than history. */
export const FAILED_JOB_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The failures in one queue that happened inside the window, newest first.
 *
 * A job with no finish time cannot be placed, so it is counted rather than
 * hidden: a fault we cannot date is still a fault.
 */
export function recentFailures(
  jobs: ReadonlyArray<{ failedReason?: string; finishedOn?: number } | undefined>,
  now: Date,
): { failed: number; reasons: string[] } {
  const since = now.getTime() - FAILED_JOB_WINDOW_MS;
  const recent = jobs
    .filter((job): job is { failedReason?: string; finishedOn?: number } => Boolean(job))
    .filter((job) => typeof job.finishedOn !== "number" || job.finishedOn >= since)
    .sort((a, b) => (b.finishedOn ?? Infinity) - (a.finishedOn ?? Infinity));
  return {
    failed: recent.length,
    reasons: recent
      .slice(0, 3)
      .map((job) => String(job.failedReason ?? "").slice(0, 160))
      .filter(Boolean),
  };
}

export async function collectIssues(
  ctx: WorkerContext,
  now: Date = new Date(),
  queueCounts: QueueCounts | null = null,
): Promise<Issue[]> {
  const { db } = ctx;
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);

  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const [
    { data: workspaces },
    { data: profiles },
    { data: accounts },
    { data: campaigns },
    { data: campaignProspects },
    { data: beats },
    { data: events },
    { data: llmFailures },
    { data: stuckEmails },
    { data: openTickets },
    { data: settingsRow },
  ] = await Promise.all([
    db.from("workspaces").select("id, name, created_at"),
    db.from("profiles").select("id, email, full_name, created_at"),
    db
      .from("linkedin_accounts")
      .select(
        "id, workspace_id, user_id, status, status_detail, provider_account_id, invites_paused_until, invites_paused_reason, created_at",
      ),
    db.from("campaigns").select("id, workspace_id, name, status, launched_at, linkedin_account_id, created_at, updated_at"),
    db.from("campaign_prospects").select("campaign_id, status").limit(20000),
    db.from("worker_heartbeats").select("name, beat_at, detail"),
    db
      .from("events")
      .select("workspace_id, name, actor_user_id, subject_id, payload, created_at")
      .in("name", [
        "campaign.notes_missing",
        "targeting.stopped",
        "linkedin.account.reauth_required",
      ])
      .gte("created_at", weekAgo),
    db
      .from("llm_calls")
      .select("workspace_id, agent, error, created_at")
      .gte("created_at", new Date(now.getTime() - DAY).toISOString())
      .not("error", "is", null),
    db.from("email_sends").select("user_id, step, status, created_at").eq("status", "claimed"),
    db.from("support_tickets").select("id, workspace_id, drafted_at, created_at").eq("status", "open"),
    db.from("platform_settings").select("outreach_paused_at, outreach_paused_reason").maybeSingle(),
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

  if (settingsRow?.outreach_paused_at) {
    add({ id: "platform:outreach-paused", severity: "critical", area: "Platform", title: "Outreach is paused for every account", detail: `${settingsRow.outreach_paused_reason ?? "No reason given."} Lift it on the Settings tab.`, since: settingsRow.outreach_paused_at });
  }

  // ── Support ─────────────────────────────────────────────────────────────
  // A ticket the assistant held is a customer waiting on a person. Said here so
  // it is on the one list an operator reads, not only on the Support tab.
  const waiting = (openTickets ?? []).filter((t) => t.drafted_at);
  if (waiting.length) {
    const oldest = waiting.map((t) => t.created_at).sort()[0] ?? null;
    add({
      id: "support:waiting",
      severity: age(oldest, now) > DAY ? "warning" : "info",
      area: "Support",
      title: `${waiting.length} support ticket${waiting.length === 1 ? "" : "s"} waiting for a person`,
      detail: "The assistant drafted an answer and held it. Read it on the Support tab and send or edit it.",
      since: oldest,
    });
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
  if (delivery && standingWebhookRefusal(delivery, registration)) {
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

  // ── Unipile ─────────────────────────────────────────────────────────────
  // Only what the provider did, never what a member has not done yet: an
  // account the provider stopped recognising is a system fault, a sign-in a
  // person never finished is not.
  for (const account of accounts ?? []) {
    if (!account.provider_account_id) continue;
    if (["reauth_required", "disconnected"].includes(account.status)) {
      add({
        id: `unipile:dropped:${account.id}`,
        severity: "critical",
        area: "Unipile",
        title: `The provider no longer accepts this account (${account.status.replaceAll("_", " ")})`,
        detail: account.status_detail ?? "Every job for this account fails until it is reconnected or re-pointed.",
        ...at(account.workspace_id),
        person: person.get(account.user_id) ?? null,
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
        area: "Unipile",
        title: "The provider holds an account nobody here owns",
        detail: `Account ${providerAccount.providerAccountId}${providerAccount.reference ? ` labelled "${providerAccount.reference}"` : ""} is connected at the provider and attached to no member. It may be a duplicate connection worth deleting there.`,
      });
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
    if ((c.failed ?? 0) > 0) {
      add({ id: `campaigns:failed:${campaign.id}`, severity: "warning", area: "Campaigns", title: `${c.failed} failed in "${campaign.name}"`, detail: "Rows marked failed are not retried; read the campaign's failures.", ...base });
    }
  }
  for (const event of (events ?? []).filter((e) => e.name === "targeting.stopped")) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    add({ id: `campaigns:targeting:${event.workspace_id}:${event.created_at}`, severity: "warning", area: "Campaigns", title: "Finding prospects stopped", detail: String(payload.reason ?? "No reason recorded."), ...at(event.workspace_id), since: event.created_at });
  }
  // Read from the campaign as it is now, not from the event. Nightly
  // maintenance fills the missing notes (`fillMissingNotes`), and a row that
  // kept saying "1 of 40 not personalised" after the note was written would be
  // reporting a fault that no longer exists.
  const notesEvents = (events ?? []).filter((e) => e.name === "campaign.notes_missing" && e.subject_id);
  const stillMissing = new Map<string, number>();
  if (notesEvents.length) {
    const { data: gaps } = await db
      .from("campaign_prospects")
      .select("campaign_id")
      .in("campaign_id", [...new Set(notesEvents.map((e) => e.subject_id as string))])
      .eq("status", "queued")
      .is("invite_note", null);
    for (const row of gaps ?? []) stillMissing.set(row.campaign_id, (stillMissing.get(row.campaign_id) ?? 0) + 1);
  }
  const reportedNotes = new Set<string>();
  for (const event of notesEvents) {
    const campaignId = event.subject_id as string;
    const missing = stillMissing.get(campaignId) ?? 0;
    if (!missing || reportedNotes.has(campaignId)) continue;
    reportedNotes.add(campaignId);
    add({ id: `campaigns:notes:${campaignId}`, severity: "info", area: "Campaigns", title: "Some invitation notes fell back to the template", detail: `${missing} ${missing === 1 ? "person is" : "people are"} still queued without a personalised note. Maintenance retries this nightly until the campaign launches.`, ...at(event.workspace_id), since: event.created_at });
  }

  // ── Jobs ────────────────────────────────────────────────────────────────
  // Background work that threw past its retries. A failed job is a unit of
  // work the system promised and did not do. Counted over the last day only
  // (`recentFailures`), because the queue keeps old ones long after the cause
  // was fixed.
  for (const [queue, counts] of Object.entries(queueCounts ?? {})) {
    if (counts.failed > 0) {
      add({
        id: `jobs:failed:${queue}`,
        severity: "warning",
        area: "Jobs",
        title: `${counts.failed} failed job${counts.failed === 1 ? "" : "s"} in the ${queue} queue in the last day`,
        detail: counts.reasons.length ? `Most recent: ${counts.reasons.join(" · ")}` : "No reason recorded.",
      });
    }
  }

  // ── AI ──────────────────────────────────────────────────────────────────
  const byAgent = new Map<string, { count: number; last: string; error: string; workspaceId: string }>();
  for (const call of llmFailures ?? []) {
    const prev = byAgent.get(call.agent);
    if (!prev || call.created_at > prev.last) {
      byAgent.set(call.agent, { count: (prev?.count ?? 0) + 1, last: call.created_at, error: String(call.error), workspaceId: call.workspace_id ?? "" });
    } else {
      prev.count += 1;
    }
  }
  for (const [agent, info] of byAgent) {
    add({
      id: `ai:${agent}`,
      severity: info.count >= 5 ? "critical" : "warning",
      area: "AI",
      title: `${info.count} failed ${agent} call${info.count === 1 ? "" : "s"} in the last day`,
      detail: info.error.slice(0, 300),
      ...at(info.workspaceId || null),
      since: info.last,
    });
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

  const rank: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.area.localeCompare(b.area));
}
