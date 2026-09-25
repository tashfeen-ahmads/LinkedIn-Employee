/**
 * What the agent did, said the way a colleague would say it.
 *
 * Everything in here already existed as rows — warmed, invited, accepted,
 * messaged, replied, held, throttled — and nobody had ever assembled them into
 * a sentence. A rep opened the product to a funnel chart and a strategy list,
 * which answer "how is it going" and never answer "what happened yesterday".
 * Those are different questions, and only the second one makes a subscription
 * feel like a salary rather than a fee.
 *
 * Pure on purpose, for the reason every rule in this repo is: the words are
 * the part that must not drift. The screen reads it today and the weekly email
 * will read it later, and if each assembled its own prose the two would say
 * different things about the same day — with the rep believing whichever they
 * happened to open.
 *
 * Four rules govern the prose, and each one is a mistake this product has
 * already made somewhere else.
 *
 * A dead loop is reported first and alone. "Nothing went out today" is a
 * reassuring sentence about a system that will never send, and rule 21 is
 * explicit that the loop being down outranks every gentler explanation.
 *
 * Zero is omitted, never stated. "0 meetings booked" reads as failure on a day
 * when nobody was ever going to book one; leaving it out reads as "it did not
 * come up", which is the truth.
 *
 * A quiet day says *why* it was quiet. Outside working hours, allowance spent,
 * nobody left, LinkedIn holding — four different situations that produce the
 * same silence and need four different responses from the reader.
 *
 * And what is waiting for a person is always said, even on a busy day. It is
 * the only part of the report that is an ask rather than a statement.
 */

/** One thing stopped until a human deals with it. */
export interface HeldItem {
  /** In the rep's words: "asked about pricing", "wants to speak to a person". */
  reason: string;
  count: number;
}

/** Why the loop declined to send, when it declined for a reason worth saying. */
export type QuietReason =
  | "outside_working_hours"
  | "allowance_spent"
  | "nobody_queued"
  | "throttled"
  | "no_campaigns"
  | "unknown";

export interface ReportFacts {
  /** Profiles looked at, as a warm-up before inviting. */
  warmed: number;
  invited: number;
  accepted: number;
  /** First messages and follow-ups actually sent. */
  messaged: number;
  /** Inbound messages from prospects. */
  replies: number;
  meetings: number;
  optedOut: number;
  /** Conversations waiting on a person right now, grouped by reason. */
  held: HeldItem[];
  /**
   * Provider throttles during the window: how long invitations were held.
   *
   * Reported because it is the difference between "your campaign did nothing"
   * and "LinkedIn asked us to slow down and we did" — which is the product
   * working, and reads as the product failing when it is not said.
   */
  throttledMs: number;
  /** Invitations sent today against what this account is allowed today. */
  allowance: { used: number; cap: number } | null;
  /**
   * The sending loop has not run recently.
   *
   * Reported ahead of everything else and on its own. A campaign launched into
   * a dead worker and a campaign correctly waiting out its gap are the same
   * screen, and the first live launch was spent on that question.
   */
  loopStalled: boolean;
  /** Why nothing was sent, when nothing was. */
  quietReason?: QuietReason;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "about 4 hours", "about 40 minutes" — a duration a person would say aloud. */
export function roughly(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `about ${plural(Math.max(1, minutes), "minute")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `about ${plural(hours, "hour")}`;
  return `about ${plural(Math.round(hours / 24), "day")}`;
}

function quietSentence(reason: QuietReason | undefined, throttledMs: number): string {
  switch (reason) {
    case "outside_working_hours":
      return "Nothing went out — it was outside your sending hours.";
    case "allowance_spent":
      return "Nothing more went out — today's invitation allowance was already used up.";
    case "nobody_queued":
      return "Nothing went out — there is nobody left waiting on any running campaign.";
    case "throttled":
      return `Nothing went out — LinkedIn held invitations from this account for ${roughly(throttledMs)}.`;
    case "no_campaigns":
      return "Nothing went out — no campaign is running.";
    default:
      // Named as unexplained rather than dressed up. A quiet day with no
      // reason attached is worth somebody looking at, and a confident
      // sentence about it would stop them looking.
      return "Nothing went out today, and nothing in the record says why.";
  }
}

/**
 * The report, as the sentences a person would actually read.
 *
 * Returned as a list rather than one string so the screen can space them and
 * the email can keep them as paragraphs, without either one re-splitting prose
 * on full stops.
 */
export function dailyReport(facts: ReportFacts): string[] {
  /*
   * The loop first, and nothing else.
   *
   * Everything below describes work being done. If the thing that does the
   * work is not running, every one of those sentences is a comfortable lie,
   * and the reader needs to stop reading and go and fix the deployment.
   */
  if (facts.loopStalled) {
    return [
      "Nothing is being sent: the sending loop is not running.",
      "That is a problem with the deployment rather than with your campaigns — nothing queued will go out until it is back. The System check has the detail.",
    ];
  }

  const lines: string[] = [];

  // What went out. Built as clauses so a day with one of the three does not
  // read as a list of zeroes.
  const outbound: string[] = [];
  if (facts.warmed > 0) outbound.push(`looked at ${plural(facts.warmed, "profile")}`);
  if (facts.invited > 0) outbound.push(`sent ${plural(facts.invited, "invitation")}`);
  if (facts.messaged > 0) outbound.push(`wrote ${plural(facts.messaged, "message")}`);

  if (outbound.length === 0) {
    lines.push(quietSentence(facts.quietReason, facts.throttledMs));
  } else {
    lines.push(`I ${joinClauses(outbound)}.`);
  }

  if (facts.accepted > 0) {
    lines.push(
      facts.accepted === 1
        ? "1 person accepted."
        : `${facts.accepted} people accepted.`,
    );
  }

  if (facts.replies > 0) {
    lines.push(facts.replies === 1 ? "1 person replied." : `${facts.replies} people replied.`);
  }

  if (facts.meetings > 0) {
    lines.push(`${plural(facts.meetings, "meeting")} booked.`);
  }

  if (facts.optedOut > 0) {
    // Said plainly rather than buried. An opt-out is the one outcome where
    // knowing quickly changes what a rep does next.
    lines.push(
      `${plural(facts.optedOut, "person", "people")} asked not to be contacted, and nothing more will go to them.`,
    );
  }

  /*
   * The throttle, when the day was not otherwise silent.
   *
   * A campaign that was held for four hours and still sent eleven invitations
   * is a good day with an explanation in it, and without the explanation the
   * numbers look like an underperforming campaign.
   */
  if (facts.throttledMs > 0 && outbound.length > 0) {
    lines.push(
      facts.warmed > 0
        ? `LinkedIn slowed invitations down for ${roughly(facts.throttledMs)}, so I spent that time looking at profiles for the next batch instead.`
        : `LinkedIn slowed invitations down for ${roughly(facts.throttledMs)}. That is the platform asking for a slower pace, not a fault, and it lifts on its own.`,
    );
  }

  /*
   * The ask, always said.
   *
   * The only part of this report that is not a statement. A busy day with a
   * held reply in it is still a day where somebody has to do something, and
   * burying that under good news is how a warm lead goes cold on a Friday.
   */
  const waiting = facts.held.reduce((sum, item) => sum + item.count, 0);
  if (waiting > 0) {
    const reasons = facts.held
      .filter((item) => item.count > 0 && item.reason.trim())
      .slice(0, 3)
      .map((item) => (item.count > 1 ? `${item.reason} (${item.count})` : item.reason));
    lines.push(
      reasons.length > 0
        ? `${waiting === 1 ? "One conversation is" : `${waiting} conversations are`} waiting for you: ${joinClauses(reasons)}.`
        : `${waiting === 1 ? "One conversation is" : `${waiting} conversations are`} waiting for you.`,
    );
  }

  /*
   * And the sentence that is the whole reason somebody renews.
   *
   * The most expensive engineering in this repo — the caps, the ramp, the
   * backoff — is invisible unless it fails. Said once a day, on a day it
   * worked, it becomes the reason to stay rather than a cost nobody sees.
   * Only when something actually went out: claiming to be inside the limits
   * on a day we sent nothing is technically true and worthless.
   */
  if (facts.allowance && outbound.length > 0 && facts.throttledMs === 0) {
    lines.push(
      `Well inside your limits — ${facts.allowance.used} of ${facts.allowance.cap} invitations today, and LinkedIn has not pushed back.`,
    );
  }

  return lines;
}

/** "a, b and c" — an Oxford-free list, because this is prose and not a table. */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
