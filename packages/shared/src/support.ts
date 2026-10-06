import { z } from "zod";

/**
 * Support, answered by an assistant — and the rules for when it may.
 *
 * Three tickets sat unanswered for four days because answering one meant an
 * operator noticing it, opening a SQL editor or the console, and writing back.
 * Every one of them was a question the product's own guide already answers
 * ("how do I approve", "what does held mean"). So the assistant reads each
 * ticket with the guide and the workspace's own state in front of it, and
 * answers.
 *
 * It answers **only when it should**. That decision is `supportGate`, and it is
 * pure for the reason `applyRules` is (rule 5): the model's own opinion of its
 * answer is one input, never the verdict. A held answer is not lost — it is
 * prefilled in the operator's reply box — so holding costs a minute and sending
 * a wrong one costs a customer.
 */
export const SUPPORT_CATEGORIES = [
  "how_to",
  "linkedin_connection",
  "campaign_not_sending",
  "replies_and_inbox",
  "strategy_and_prospects",
  "account_and_billing",
  "bug",
  "feature_request",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  how_to: "How to",
  linkedin_connection: "LinkedIn connection",
  campaign_not_sending: "Campaign not sending",
  replies_and_inbox: "Replies & inbox",
  strategy_and_prospects: "Strategy & prospects",
  account_and_billing: "Account & billing",
  bug: "Bug",
  feature_request: "Feature request",
  other: "Other",
};

/**
 * Categories a person always answers.
 *
 * A bug acknowledged by an assistant is a promise nobody is keeping — "we have
 * logged it" with nobody reading the log. Billing and account changes are
 * things only a person here can do, and a feature request deserves to be read
 * by the people who would build it.
 */
export const SUPPORT_HUMAN_CATEGORIES: ReadonlySet<SupportCategory> = new Set([
  "bug",
  "account_and_billing",
  "feature_request",
]);

/** Below this the assistant is guessing, and a guess is held. */
export const SUPPORT_AUTO_CONFIDENCE = 0.75;
export const SUPPORT_ANSWER_MAX_CHARS = 1500;
/**
 * An answer arriving days late is read by a person first: whatever the ticket
 * described has probably changed, and a confident reply to a situation that no
 * longer exists reads as nobody having looked.
 */
export const SUPPORT_AUTO_MAX_AGE_MS = 48 * 60 * 60_000;

/** What the assistant returns. Nullable rather than optional: structured outputs reject optional keys. */
export const SupportDraftSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  answer: z.string().describe(`The reply to the customer, at most ${SUPPORT_ANSWER_MAX_CHARS} characters.`),
  confidence: z.number().min(0).max(1),
  needsHuman: z.boolean(),
  reasonForHuman: z.string().nullable(),
});
export type SupportDraft = z.infer<typeof SupportDraftSchema>;

/**
 * Words that belong to us, not to the customer (rule 54).
 *
 * Whole words, because "rendered" and "environment" are ordinary English. A
 * SHOUTED_NAME is how an environment variable is recognised without listing
 * every one this deployment might gain.
 */
const INTERNAL_WORDS =
  /\b(unipile|resend|openai|anthropic|gpt-?\d*|redis|render\.com|supabase|bullmq|netlify|webhooks?|api[ _-]?keys?|service[ _-]role|localhost|sql|postgres(ql)?|stack ?trace)\b/i;
const INTERNAL_PATHS = /(\/webhooks\/|\/jobs\/|\/admin\b)/i;
const SHOUTED = /\b[A-Z][A-Z0-9]{2,}_[A-Z0-9_]+\b/;

/** The first internal detail in a piece of customer-facing text, or null. */
export function mentionsInternals(text: string): string | null {
  return text.match(INTERNAL_WORDS)?.[0] ?? text.match(INTERNAL_PATHS)?.[0] ?? text.match(SHOUTED)?.[0] ?? null;
}

export type SupportVerdict = { send: true } | { send: false; reason: string };

/**
 * Whether an assistant's answer goes to the customer now or waits for a person.
 *
 * Order matters only for which reason is reported; every branch holds.
 */
export function supportGate(input: {
  autopilot: boolean;
  /** The customer pressed "Still stuck" — the last automatic answer did not help. */
  reopened: boolean;
  /** How long ago the ticket was raised. */
  ageMs: number;
  draft: SupportDraft;
}): SupportVerdict {
  const { draft } = input;
  const answer = draft.answer.trim();
  if (!input.autopilot) return { send: false, reason: "Autopilot is off, so every answer waits for you." };
  if (input.reopened) {
    return { send: false, reason: "They said the last answer did not help, so a person answers this one." };
  }
  if (!(input.ageMs <= SUPPORT_AUTO_MAX_AGE_MS)) {
    return { send: false, reason: "It was raised more than two days ago, so a person checks the answer still fits." };
  }
  if (draft.needsHuman) {
    return { send: false, reason: draft.reasonForHuman?.trim() || "The assistant asked for a person." };
  }
  if (SUPPORT_HUMAN_CATEGORIES.has(draft.category)) {
    return { send: false, reason: `${SUPPORT_CATEGORY_LABEL[draft.category]} is always answered by a person.` };
  }
  if (!(draft.confidence >= SUPPORT_AUTO_CONFIDENCE)) {
    return { send: false, reason: `The assistant was only ${Math.round((draft.confidence || 0) * 100)}% sure.` };
  }
  if (answer.length < 40) return { send: false, reason: "The answer was too short to be one." };
  if (answer.length > SUPPORT_ANSWER_MAX_CHARS) return { send: false, reason: "The answer ran too long." };
  const internal = mentionsInternals(answer);
  if (internal) return { send: false, reason: `The answer mentions "${internal}", which is ours and not theirs.` };
  return { send: true };
}

/**
 * What a ticket's captured context says, in sentences an operator can read.
 *
 * The ticket carries a snapshot of what the product believed when somebody
 * pressed Raise a ticket (`context` on `support_tickets`). This turns it into
 * the three or four facts that decide which stage to look at.
 *
 * The rule here is the same one that runs through the diagnostics page: a fact
 * this snapshot does not have is **said to be missing**, never left out. A list
 * that simply does not mention the sending loop reads as a loop that was fine,
 * and sends whoever is answering to investigate the wrong stage — which is the
 * failure the snapshot exists to prevent, reintroduced at the last step.
 */
export interface TicketContext {
  stuckOn?: string | null;
  stuckOnLabel?: string | null;
  linkedInStatus?: string | null;
  linkedInDetail?: string | null;
  sendingLoopRunning?: boolean | null;
  pacingBeatAt?: string | null;
  workerBootAt?: string | null;
  workerBuild?: string | null;
  raisedAt?: string | null;
}

function asContext(value: unknown): TicketContext {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TicketContext) : {};
}

function ago(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function describeTicketContext(raw: unknown, now: number = Date.now()): string[] {
  const context = asContext(raw);
  const facts: string[] = [];

  facts.push(
    context.stuckOnLabel
      ? `Stuck on: ${context.stuckOnLabel}`
      : context.stuckOn
        ? `Stuck on: ${context.stuckOn}`
        : "Setup step: not captured",
  );

  facts.push(
    context.linkedInStatus
      ? `LinkedIn: ${context.linkedInStatus.replaceAll("_", " ")}${
          context.linkedInDetail ? ` — ${context.linkedInDetail}` : ""
        }`
      : "LinkedIn: not captured",
  );

  // The one that decides whether this is a campaign problem or a deployment
  // problem, and the one most easily read as fine when it is absent.
  const beat = ago(context.pacingBeatAt, now);
  facts.push(
    context.sendingLoopRunning === true
      ? `Sending loop: running${beat ? ` (last run ${beat})` : ""}`
      : context.sendingLoopRunning === false
        ? `Sending loop: NOT running${beat ? ` (last run ${beat})` : " (never run)"}`
        : "Sending loop: not captured",
  );

  const booted = ago(context.workerBootAt, now);
  facts.push(
    context.workerBootAt
      ? `Worker booted ${booted}${context.workerBuild ? ` on ${context.workerBuild.slice(0, 7)}` : ", build unknown"}`
      : "Worker boot: not captured",
  );

  return facts;
}
