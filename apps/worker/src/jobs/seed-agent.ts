import {
  DEFAULT_OPENER_TEMPLATE,
  HOOK_MAX_CHARS,
  PITCH_MAX_CHARS,
  blankAgent,
  type BusinessProfile,
} from "@le/shared";
import type { Db } from "@le/db";
import { recordEvent } from "../context.js";

/**
 * The workspace's one agent, built from what onboarding already learned.
 *
 * A rep who has just told this product what their company does, who they sell
 * to and how they sound should not then be handed an empty form and asked to
 * say it again. The first version of this shipped a "New agent" button that
 * produced a blank row — so the screen existed, the data existed, and the two
 * were never introduced. That is the same failure as every other one on this
 * list: something written, stored, displayed, and then dropped at the moment
 * it mattered.
 *
 * **One agent, one opener, one offer.** Not a set to choose between. A
 * workspace opening this screen for the first time has a working agent and one
 * line of each to read and edit — several of each is a comparison nobody asked
 * for before they have sent anything, and a screen of variants reads as
 * homework.
 *
 * Seeded **unapproved**, and that is deliberate. An approval is a statement
 * that a person read those exact words (rule 40), and seeding one approved
 * would make the approval screen decorative on the single screen where it
 * matters most — the first thing a stranger ever reads from this workspace.
 * The agent screen shows both lines filled in with one button each, so the
 * cost is a click rather than a blank page.
 *
 * Idempotent: a workspace that already has an agent is left exactly alone.
 * This runs on every strategy run and must never quietly add a second one, or
 * "which agent" is answered differently on different days.
 */
export async function seedWorkspaceAgent(
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    business: BusinessProfile;
    /** The name a prospect reads. The rep's own, not the company's. */
    repName: string | null;
  },
): Promise<string | null> {
  const { data: already } = await db
    .from("agents")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .is("archived_at", null)
    .limit(1);
  if (already?.length) return null;

  const seed = blankAgent(input.repName);
  const { data: agent, error } = await db
    .from("agents")
    .insert({
      workspace_id: input.workspaceId,
      // Named after the business rather than "New agent", because the name is
      // what a rep reads in a picker and "New agent" tells them nothing.
      name: input.business.companyName?.trim() || seed.name,
      // The deployment's own model is chosen at send time when this is null,
      // which is the one value that cannot be wrong: a model this deployment
      // cannot serve is a failed call, not a slower agent.
      model: null,
      system_prompt: voiceFrom(input.business, seed.systemPrompt ?? ""),
      from_name: input.repName,
      playbook: {
        objective: input.business.oneLiner?.trim().slice(0, 500) ?? "",
        qualification: [],
        handOver: "",
        // The objections this business actually hears, which is the most
        // useful thing onboarding knows and the least likely to be retyped.
        avoid: seed.playbook.avoid,
      } as never,
      custom_fields: [],
      is_default: true,
    })
    .select("id")
    .single();

  if (error || !agent) {
    // Never fatal. A workspace without a seeded agent behaves exactly as every
    // workspace did before agents existed, and losing a strategy run over a
    // convenience is the wrong trade.
    console.error("could not seed the workspace agent", { reason: error?.message });
    return null;
  }

  await db.from("hooks").insert({
    workspace_id: input.workspaceId,
    agent_id: agent.id,
    name: "Opening line",
    // The plain, recognisable shape rather than a clever sentence. A stranger
    // recognises a person naming their company faster than they recognise a
    // good line, and the agent-written openers that replaced this read as
    // generic precisely because they were written to be interesting.
    body: openerFor(input.business),
    angle: "Names them and their company, and asks one thing",
    written_by: "agent",
    approved_at: null,
    is_default: true,
  });

  await db.from("pitches").insert({
    workspace_id: input.workspaceId,
    agent_id: agent.id,
    name: "What this is",
    body: offerFrom(input.business),
    written_by: "agent",
    approved_at: null,
    is_default: true,
  });

  await recordEvent(db, {
    workspaceId: input.workspaceId,
    name: "agent.seeded",
    actorUserId: input.userId,
    subjectType: "agent",
    subjectId: agent.id,
    payload: { from: "onboarding" },
  });

  return agent.id;
}

/**
 * The opener, filled from the business and kept inside LinkedIn's limit.
 *
 * `{{rep_name}}` and `{{company}}` resolve per prospect, so this is one line
 * that reads as written for each person rather than a template they can see.
 * Truncation would leave a question with no question mark arriving from a
 * stranger, so the shipped shape is short enough that it cannot happen.
 */
function openerFor(business: BusinessProfile): string {
  const ask = firstPain(business);
  const line = ask ? `${DEFAULT_OPENER_TEMPLATE} ${ask}` : DEFAULT_OPENER_TEMPLATE;
  return line.length <= HOOK_MAX_CHARS ? line : DEFAULT_OPENER_TEMPLATE;
}

/** One short question drawn from what this business actually fixes. */
function firstPain(business: BusinessProfile): string | null {
  const source = business.differentiators?.[0] ?? business.oneLiner ?? "";
  const trimmed = source.trim();
  if (!trimmed) return null;
  // A clause, not a paragraph: the note still has to say something specific
  // about the person, and an opener that fills it leaves nothing for them.
  const short = trimmed.split(/[.;]/)[0]?.trim() ?? "";
  return short.length > 0 && short.length <= 60 ? `quick question about ${short.toLowerCase()}.` : null;
}

/**
 * The offer, in one line a person can read in a chat window on a phone.
 *
 * Built from the one-liner because that is the sentence onboarding already
 * asked for — "what the company sells and to whom" is exactly what a prospect
 * who asks "what is this?" wants. Over length it falls back to the company
 * name rather than being cut mid-clause, which would reach somebody as a
 * broken message under a real rep's name.
 */
function offerFrom(business: BusinessProfile): string {
  const line = business.oneLiner?.trim() ?? "";
  if (line && line.length <= PITCH_MAX_CHARS) return line;
  const name = business.companyName?.trim() || "We";
  const fallback = `${name} — ask me what we do and I will tell you in one line.`;
  return fallback.length <= PITCH_MAX_CHARS ? fallback : name.slice(0, PITCH_MAX_CHARS);
}

/** How it writes: the shipped baseline, plus this business's own tone. */
function voiceFrom(business: BusinessProfile, baseline: string): string {
  const tone = business.toneOfVoice?.trim();
  return tone ? `${baseline}\n\nHow this business sounds: ${tone}` : baseline;
}
