import {
  LINKEDIN_LIMITS,
  dailySends,
  type DatedFunnelRow,
} from "@le/shared";
import {
  ACCOUNT_USAGE_COLUMNS,
  dailyInviteCap,
  toUsage,
  type AccountRecord,
} from "@le/linkedin";
import { AllowanceMeter, StackedDays } from "@/components/charts";
import { Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readFunnelData } from "@/lib/funnel-data";

/**
 * How close this account is to the lines, and what it did each day.
 *
 * The most expensive engineering in this repo — the caps, the ramp from first
 * action, the escalating backoff, the warm-up on its own allowance, the day's
 * work spread across the day — is invisible unless it fails. The category's
 * dirty number is that a third of one competitor's reviewers report being
 * restricted inside ninety days, and a customer who cannot see the guardrails
 * has no way to tell this product from the one that got them banned.
 *
 * A meter rather than a number, because "12" answers "how many" and the
 * question is "how close am I to the line". And the bar is the cap rather than
 * the largest value seen, or the meter always looks full.
 */
export async function LimitsSection() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  // No connected account is not "0 of 14". The overview's list already says the
  // account needs reconnecting, and a row of empty meters underneath it would
  // be a second, quieter statement of the same thing.
  if (!account) return null;

  const { data: owner } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", account.user_id)
    .maybeSingle();
  const timezone = owner?.timezone ?? "UTC";

  const now = new Date();
  const usage = toUsage(account as AccountRecord, timezone);
  const cap = dailyInviteCap(usage.firstActionAt, now);

  /*
   * Which day of the ramp this is, said out loud.
   *
   * The ramp is measured from an account's first action rather than from when
   * it was connected (rule 3), and that difference is invisible from every
   * screen — somebody who connected three weeks ago and sent nothing sits at
   * the starting cap, correctly, and has no way to learn why.
   */
  const day = usage.firstActionAt
    ? Math.floor((now.getTime() - usage.firstActionAt.getTime()) / 86_400_000)
    : null;
  const rampNote =
    day === null
      ? "Day one until this account sends something. The ramp starts at your first invitation, not at connection."
      : day >= LINKEDIN_LIMITS.warmupDays
        ? "Fully warmed up."
        : `Day ${day + 1} of the ${LINKEDIN_LIMITS.warmupDays}-day warm-up. It rises on its own.`;

  const funnel = await readFunnelData(supabase, session.workspaceId);
  const days = stackDays(funnel.rows, now.getTime());

  return (
    <Section
      id="limits"
      title="Inside your limits"
      description="Your account's allowances, and what went out each day. These caps are product rules rather than settings — they only ever move down."
    >
      <div className="allowance-row">
        <AllowanceMeter
          label="Invitations today"
          used={usage.invitesToday}
          cap={cap}
          note={rampNote}
        />
        <AllowanceMeter
          label="Invitations this week"
          used={usage.invitesThisWeek}
          cap={LINKEDIN_LIMITS.invitesPerWeek}
        />
        <AllowanceMeter
          label="Profile views today"
          used={usage.profileViewsToday}
          cap={LINKEDIN_LIMITS.profileViewsPerDay}
          note="Warm-ups have their own allowance; they never cost an invitation."
        />
        <AllowanceMeter
          label="Messages today"
          used={usage.messagesToday}
          cap={LINKEDIN_LIMITS.messagesPerDay}
        />
      </div>

      {days.length ? (
        <StackedDays days={days} series={["Invited", "Accepted", "Replied"]} />
      ) : null}
    </Section>
  );
}

/**
 * Thirty days of work, including the days nothing happened.
 *
 * The zero days are the point: dropping them joins Friday to Monday with a
 * straight line and draws a weekend that looks like steady sending, when the
 * question this chart answers is exactly "did anything leave yesterday".
 * `dailySends` already does that walk for invitations, so the other two series
 * are counted the same way rather than a second time in a second shape.
 */
function stackDays(rows: readonly DatedFunnelRow[], now: number) {
  const invited = dailySends(rows, now);
  const byDate = new Map<string, number[]>(invited.map((d) => [d.date, [d.value, 0, 0]]));

  const bump = (iso: string | null | undefined, slot: 1 | 2) => {
    if (!iso) return;
    // Only days inside the window have a slot. An acceptance can land weeks
    // after the invitation that earned it, so a row older than the chart is
    // ordinary rather than an error.
    const day = byDate.get(iso.slice(0, 10));
    if (!day) return;
    day[slot] = (day[slot] ?? 0) + 1;
  };
  for (const row of rows) {
    bump(row.accepted_at, 1);
    bump(row.replied_at, 2);
  }

  return invited.map((d) => ({ date: d.date, values: byDate.get(d.date) ?? [0, 0, 0] }));
}
