import { LINKEDIN_LIMITS } from "@le/shared";
import { classifyProviderError } from "@le/linkedin";
import type { Db } from "@le/db";
import { followUpDueAt } from "./acceptance.js";
import { stepFor } from "../sequence.js";

/**
 * Puts the sequence back on the rails for anybody who fell off it.
 *
 * A campaign prospect moves forward because `next_action_at` says when. Every
 * path that sets it is correct today, but a row can still end up with no next
 * action and no way back: a job that threw between the send and the reschedule,
 * a status written by a version of the code that computed the delay wrongly, a
 * step deleted from under a prospect mid-sequence. The first live acceptance
 * landed in exactly that state.
 *
 * Nothing noticed. The prospect sits in `accepted` or `messaged_1` for ever,
 * the campaign reports `running`, and the funnel reads zero — which the person
 * who launched it correctly reads as "the agent is doing nothing".
 *
 * So the agent repairs its own queue rather than waiting for somebody to spot
 * it and write an update by hand. Repair must never depend on a person finding
 * a button, and it must never depend on one opening psql either.
 *
 * Two things it deliberately does not do. It never *brings forward* a schedule
 * somebody is waiting out — only a missing or long-overdue one is re-armed, or
 * this would collapse every configured delay to now. And it never invents a
 * step: a prospect whose sequence has genuinely ended is left alone, because
 * the end of a sequence is an answer.
 *
 * There is exactly one schedule it does move earlier, and it is the case the
 * docstring above already names: a first message that an older rule pushed days
 * out. Step 1 has no configurable delay (rule 43) — the acceptance is what it
 * waits for — so there is no rep's judgement to collapse here and exactly one
 * correct answer. Three real prospects accepted a connection request and were
 * holding schedules up to three days out, written by code that has since been
 * corrected; without this they would have waited them out in full. It is
 * deliberately narrow: `accepted`, never messaged, and only when the stored
 * time is beyond the window the rule allows.
 */
export async function unstickProspects(db: Db, now: Date = new Date(), limit = 200): Promise<number> {
  // The statuses that mean "mid-sequence, waiting for the next message". A
  // queued prospect has not been invited; a closed, failed or opted-out one is
  // finished and must never be restarted.
  const LIVE = ["accepted", "messaged_1", "messaged_2", "messaged_3"] as const;

  // An hour of slack: a row whose time has just passed is not stuck, it is
  // waiting for the next tick, and re-arming it would move it backwards.
  const overdueBefore = now.getTime() - 60 * 60_000;

  /*
   * Only rows that could be stuck are read, and in a fixed order.
   *
   * This read every live row, unordered, two hundred at a time, and only then
   * asked which were stuck. Healthy rows waiting out a configured step delay
   * filled the window — a campaign a few hundred deep is mostly those — so a
   * stuck row past the first two hundred was never examined, on any run, ever.
   * Three narrow questions instead, each in the database: no schedule at all,
   * a schedule long overdue, and a first message pushed further out than the
   * acceptance window allows. Oldest first, so whatever is not reached this
   * hour is reached next.
   */
  const COLUMNS = "id, campaign_id, variant_id, status, last_step_sent, next_action_at, accepted_at, status_reason";
  const [{ data: unscheduled }, { data: overdue }, { data: distant }] = await Promise.all([
    db
      .from("campaign_prospects")
      .select(COLUMNS)
      .in("status", LIVE)
      .is("next_action_at", null)
      .order("updated_at")
      .limit(limit),
    db
      .from("campaign_prospects")
      .select(COLUMNS)
      .in("status", LIVE)
      .lt("next_action_at", new Date(overdueBefore).toISOString())
      .order("next_action_at")
      .limit(limit),
    db
      .from("campaign_prospects")
      .select(COLUMNS)
      .eq("status", "accepted")
      // Mid-sequence rows come back too and are turned away by
      // staleAcceptWindow, the one place that rule lives: filtered here as
      // well, a broken copy of it there could never be noticed by a test.
      .gte("next_action_at", new Date(now.getTime() + LINKEDIN_LIMITS.acceptFollowUpMaxMs).toISOString())
      .order("next_action_at")
      .limit(limit),
  ]);
  const rows = [...(unscheduled ?? []), ...(overdue ?? []), ...(distant ?? [])];

  let repaired = 0;
  for (const row of rows ?? []) {
    const due = row.next_action_at ? Date.parse(row.next_action_at) : null;
    const stuck = due === null || (Number.isFinite(due) && (due as number) < overdueBefore);

    if (!stuck) {
      if (!staleAcceptWindow(row, due, now)) continue;
      await db
        .from("campaign_prospects")
        // Into the window the rule gives it, counted from now rather than from
        // the acceptance: the acceptance may be days ago, and a time in the
        // past would land this message in the same second the tick notices it,
        // which is the robot-announcing-itself pattern the window exists to
        // avoid.
        .update({ next_action_at: followUpDueAt(now, 0).toISOString() })
        .eq("id", row.id);
      repaired += 1;
      continue;
    }

    const nextNumber = (row.last_step_sent ?? 0) + 1;
    // The same resolution the send path uses, not a second reading of it. This
    // used to fall back to the campaign-wide step whenever the angle had no
    // step N — so somebody whose angle's sequence had ended was re-armed for a
    // step the send path would then refuse, every hour, and a reader of this
    // loop was told the sequence went on when it did not.
    const step = await stepFor(db, row.campaign_id, row.variant_id ?? null, nextNumber);
    // No step left. The sequence is over for this person, which is an outcome
    // rather than a fault, and inventing one would message somebody twice.
    if (!step) continue;

    await db
      .from("campaign_prospects")
      // Due now rather than `now + delay_days`: the delay was already served
      // while the row sat here. The limiter still decides the actual minute,
      // so this schedules the work rather than performing it.
      .update({ next_action_at: now.toISOString() })
      .eq("id", row.id);
    repaired += 1;
  }
  return repaired;
}

/**
 * Whether this row's first message is scheduled by a rule the product no longer
 * has.
 *
 * Narrow on purpose. It has to be somebody who accepted and has never been
 * written to, and their stored time has to sit beyond the longest wait the
 * acceptance window permits — so a prospect correctly waiting out the twenty to
 * ninety minutes is never touched, and neither is anybody mid-sequence, whose
 * delays are the rep's to set.
 */
function staleAcceptWindow(
  row: { status: string; last_step_sent: number | null; accepted_at: string | null; status_reason?: string | null },
  due: number | null,
  now: Date,
): boolean {
  if (row.status !== "accepted" || (row.last_step_sent ?? 0) !== 0) return false;
  if (due === null || !Number.isFinite(due)) return false;
  const acceptedAt = row.accepted_at ? Date.parse(row.accepted_at) : NaN;
  if (!Number.isFinite(acceptedAt)) return false;
  /*
   * ...and not a cooldown LinkedIn asked for.
   *
   * A first follow-up refused with "try later" is put back on the schedule
   * after the provider's own cooldown — two hours for a 429, six for a limit —
   * and that row is exactly this shape: accepted, never messaged, due well
   * after the acceptance window. Pulled forward, the provider was asked again
   * inside its own cooldown, every hour. The send path writes the provider's
   * words on the row, and a time no later than that cooldown from now is the
   * provider's schedule, not an old rule's.
   */
  const refusal = classifyProviderError(row.status_reason);
  if (refusal.kind === "retry_later" && due <= now.getTime() + refusal.cooldownMs + LINKEDIN_LIMITS.maxGapMs) {
    return false;
  }
  return due > acceptedAt + LINKEDIN_LIMITS.acceptFollowUpMaxMs;
}

/**
 * Gives back the prospects a temporary refusal wrote off permanently.
 *
 * `failed` is meant to be an outcome: this person cannot be invited, stop
 * asking. For most of a morning it also meant "LinkedIn said *please try again
 * later* and we did not". Seven real people were marked failed in twenty-five
 * minutes on an error whose own words were an instruction to retry, and
 * `failProspect` clears `next_action_at`, so nothing was ever going to pick
 * them up again. The campaign screen showed seven failures, which reads as
 * seven bad prospects and a list that did not work.
 *
 * The send path no longer writes those rows (`handleInviteRefusal` requeues
 * them), but the ones already written are still sitting there, and repair must
 * never depend on somebody noticing and writing an UPDATE by hand — rule 8, and
 * the reason this whole file exists.
 *
 * Deliberately narrow. Only `failed`, only where the stored reason is one the
 * classifier itself calls retryable, and only where the invitation never
 * actually went out. A row that was genuinely refused — "cannot send invitation
 * to this member" — is left exactly alone, because putting that person back in
 * the queue spends a daily invitation on a send that will fail again and posts
 * another rejected request against the account.
 */
export async function recoverThrottledProspects(
  db: Db,
  now: Date = new Date(),
  limit = 500,
): Promise<number> {
  /*
   * Walked in pages, oldest first, past the rows it can never recover.
   *
   * One unordered read of five hundred `failed` rows meant permanent refusals
   * — which accumulate and are never touched again — filled the window, and a
   * recoverable row behind them was never examined. The ones that ever went
   * out are filtered in the query, and the rest are read until the end.
   */
  const rows: Array<{ id: string; status_reason: string | null; invited_at: string | null }> = [];
  for (let page = 0; page < RECOVER_MAX_PAGES; page++) {
    const { data } = await db
      .from("campaign_prospects")
      .select("id, status, status_reason, invited_at")
      .eq("status", "failed")
      // An invitation that really went out is not a refusal, whatever the row
      // says: re-queueing it would invite somebody twice.
      .is("invited_at", null)
      .order("id")
      .range(page * limit, page * limit + limit - 1);
    rows.push(...(data ?? []));
    if ((data ?? []).length < limit) break;
  }

  let recovered = 0;
  for (const row of rows) {
    if (classifyProviderError(row.status_reason).kind !== "retry_later") continue;

    await db
      .from("campaign_prospects")
      // Straight back to the queue with no schedule of its own: the pacing loop
      // owns when, and the account's own cooldown is what holds it until
      // LinkedIn is ready. Setting a time here would be a second opinion about
      // that, and the two would drift.
      .update({ status: "queued", status_reason: null, next_action_at: null })
      .eq("id", row.id);
    recovered += 1;
  }
  if (recovered) console.log("returned throttled prospects to the queue", { recovered, at: now.toISOString() });
  return recovered;
}

/** How many pages of failed rows one recovery run reads at most. */
const RECOVER_MAX_PAGES = 20;
