import {
  PACING_LOOP,
  PACING_STALE_MS,
  dailyReport,
  type QuietReason,
  type ReportFacts,
} from "@le/shared";
import { dailyInviteCap, parseWorkingHours, toUsage, type AccountRecord } from "@le/linkedin";
import { ACCOUNT_USAGE_COLUMNS } from "@le/linkedin";
import type { Db } from "@le/db";

/**
 * The facts behind the daily report, gathered for one workspace and one day.
 *
 * The words live in `@le/shared` and the gathering lives here, which is the
 * split this repo already uses for the funnel: the prose is the part two
 * callers must never disagree about, and the query is a handful of counts.
 *
 * Everything below is a row somebody already writes. Nothing here is new
 * instrumentation — the whole point of this screen is that the product has
 * been recording its own work since the first week and never told anybody.
 */

/** The events that describe a day's work, and the fact each one feeds. */
const COUNTED = [
  "prospect.warmed",
  "invite.sent",
  "invite.accepted",
  "message.sent",
  "reply.sent",
  "message.received",
  "meeting.booked",
  "prospect.opted_out",
  "invite.throttled",
] as const;

export interface DayWindow {
  from: Date;
  to: Date;
}

/** Midnight to midnight in the rep's own zone, for the day `now` falls in. */
export function dayWindow(now: Date, timezone: string): DayWindow {
  // Formatted in the target zone and re-parsed as UTC gives that zone's local
  // date; the offset is then the difference between the two.
  const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const offsetMs = now.getTime() - local.getTime();
  const startLocal = new Date(local);
  startLocal.setHours(0, 0, 0, 0);
  const from = new Date(startLocal.getTime() + offsetMs);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/**
 * Overlapping holds merged, then clipped to the window.
 *
 * Several jobs can be refused inside one throttle and each writes its own
 * event, so summing the raw durations reports thirty hours of hold on a
 * six-hour day. Merging is what makes the number something a person can
 * believe.
 */
export function throttledMsIn(
  holds: Array<{ start: number; end: number }>,
  window: DayWindow,
): number {
  const clipped = holds
    .map((h) => ({
      start: Math.max(h.start, window.from.getTime()),
      end: Math.min(h.end, window.to.getTime()),
    }))
    .filter((h) => h.end > h.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let cursor = -1;
  let open = -1;
  for (const hold of clipped) {
    if (open === -1) {
      open = hold.start;
      cursor = hold.end;
      continue;
    }
    if (hold.start <= cursor) {
      cursor = Math.max(cursor, hold.end);
      continue;
    }
    total += cursor - open;
    open = hold.start;
    cursor = hold.end;
  }
  if (open !== -1) total += cursor - open;
  return total;
}

export interface DailyReportResult {
  lines: string[];
  facts: ReportFacts;
  window: DayWindow;
}

export async function loadDailyReport(
  db: Db,
  workspaceId: string,
  now: Date = new Date(),
): Promise<DailyReportResult> {
  const { data: account } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const { data: owner } = account
    ? await db.from("profiles").select("timezone").eq("id", account.user_id).maybeSingle()
    : { data: null };
  const timezone = owner?.timezone ?? "UTC";
  const window = dayWindow(now, timezone);

  const [{ data: events }, { data: waiting }, { data: beat }, { data: running }] = await Promise.all([
    db
      .from("events")
      .select("name, payload, created_at")
      .eq("workspace_id", workspaceId)
      .in("name", COUNTED as unknown as string[])
      .gte("created_at", window.from.toISOString())
      .lt("created_at", window.to.toISOString())
      .limit(2000),
    // Held right now, not held today. "What is waiting for you" is a question
    // about this moment — a reply answered an hour ago is not an ask.
    db
      .from("conversations")
      .select("needs_human_reason")
      .eq("workspace_id", workspaceId)
      .eq("needs_human", true)
      .limit(200),
    db.from("worker_heartbeats").select("beat_at").eq("name", PACING_LOOP).maybeSingle(),
    db.from("campaigns").select("id").eq("workspace_id", workspaceId).eq("status", "running").limit(1),
  ]);

  const count = (name: string) => (events ?? []).filter((row) => row.name === name).length;

  const holds = (events ?? [])
    .filter((row) => row.name === "invite.throttled")
    .map((row) => {
      const until = Date.parse((row.payload as { until?: string } | null)?.until ?? "");
      const start = Date.parse(row.created_at);
      return { start, end: until };
    })
    .filter((h) => Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start);

  const held = new Map<string, number>();
  for (const row of waiting ?? []) {
    const reason = (row.needs_human_reason ?? "").trim();
    held.set(reason, (held.get(reason) ?? 0) + 1);
  }

  const warmed = count("prospect.warmed");
  const invited = count("invite.sent");
  // Both halves of the conversation the agent holds up: the first message
  // after an acceptance and every reply it was allowed to send.
  const messaged = count("message.sent") + count("reply.sent");

  const stamped = beat?.beat_at ? Date.parse(beat.beat_at) : null;
  const loopStalled = stamped === null || now.getTime() - stamped > PACING_STALE_MS;

  const allowance = account
    ? { used: account.invites_today, cap: dailyInviteCap(toUsage(account as AccountRecord, timezone).firstActionAt, now) }
    : null;

  const facts: ReportFacts = {
    warmed,
    invited,
    accepted: count("invite.accepted"),
    messaged,
    replies: count("message.received"),
    meetings: count("meeting.booked"),
    optedOut: count("prospect.opted_out"),
    held: [...held.entries()]
      .map(([reason, n]) => ({ reason, count: n }))
      .sort((a, b) => b.count - a.count),
    throttledMs: throttledMsIn(holds, window),
    allowance,
    loopStalled,
  };

  if (warmed + invited + messaged === 0) {
    facts.quietReason = await quietReason(db, workspaceId, {
      hasRunningCampaign: Boolean(running?.length),
      account: (account as AccountRecord | null) ?? null,
      timezone,
      allowance,
      throttledMs: facts.throttledMs,
      now,
    });
  }

  return { lines: dailyReport(facts), facts, window };
}

/**
 * Why nothing went out, as specifically as the evidence allows.
 *
 * Four situations produce the same silence and need four different responses
 * from whoever is reading, and the difference between them is the whole value
 * of saying anything at all. Ordered by what the reader can do about it: no
 * campaign is their move, a throttle is nobody's, an empty allowance is
 * tomorrow, an empty list is the Find more button.
 */
async function quietReason(
  db: Db,
  workspaceId: string,
  input: {
    hasRunningCampaign: boolean;
    account: AccountRecord | null;
    timezone: string;
    allowance: { used: number; cap: number } | null;
    throttledMs: number;
    now: Date;
  },
): Promise<QuietReason> {
  if (!input.hasRunningCampaign) return "no_campaigns";
  if (input.throttledMs > 0) return "throttled";
  if (input.allowance && input.allowance.used >= input.allowance.cap) return "allowance_spent";

  const { count } = await db
    .from("campaign_prospects")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "queued");
  if (!count) return "nobody_queued";

  // A weekend, or a day whose working hours have not started. Read off the
  // account's own hours so the screen and the sender agree about what a
  // working day is.
  if (input.account) {
    const hours = parseWorkingHours(input.account.working_hours);
    const weekday = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, weekday: "short" })
        .format(input.now)
        .replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (d) =>
          String(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d)),
        ),
    );
    if (Number.isFinite(weekday) && !hours.days.includes(weekday)) return "outside_working_hours";
  }

  return "unknown";
}
