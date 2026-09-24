import {
  BusinessProfileSchema,
  DEFAULT_OPENER_TEMPLATE,
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
    userId: string | null;
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

  /*
   * `is_default` is deliberately absent from both lines below.
   *
   * It means "the workspace's fallback", and `hooks_one_default` enforces one
   * per workspace. The agent's own lines are found by `agent_id`, so setting
   * it buys nothing — and on a workspace that already had a default it made
   * the insert violate that index.
   *
   * Which is exactly what happened: the first seeded agent on this deployment
   * was created with no opener and no offer at all, because the insert failed
   * and nothing looked at the error. An agent that exists and cannot write is
   * worse than one that was never made, because the screen says it is ready.
   */
  const { error: hookError } = await db.from("hooks").insert({
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
  });

  const { error: pitchError } = await db.from("pitches").insert({
    workspace_id: input.workspaceId,
    agent_id: agent.id,
    name: "What this is",
    body: offerFrom(input.business),
    written_by: "agent",
    approved_at: null,
  });

  // Reported, never swallowed. A half-seeded agent is the failure this whole
  // sweep exists to prevent, and the only thing worse than not seeding one is
  // seeding one that cannot write and saying nothing.
  if (hookError || pitchError) {
    console.error("the agent was created but its copy was not", {
      workspaceId: input.workspaceId,
      agentId: agent.id,
      hook: hookError?.message ?? null,
      pitch: pitchError?.message ?? null,
    });
  }

  await recordEvent(db, {
    workspaceId: input.workspaceId,
    name: "agent.seeded",
    actorUserId: input.userId ?? undefined,
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
function openerFor(_business: BusinessProfile): string {
  /*
   * The greeting, and nothing after it.
   *
   * A first version derived a question from the business's own
   * differentiators, and what it produced for the two real businesses on this
   * deployment was "— AI-powered matching that scores pairs on seven
   * factors?": a product claim with a question mark on the end, inside a
   * connection request. The invitation may not pitch (rule 40), and that is
   * not a rule a clever derivation gets to route around.
   *
   * It was also the wrong question. The one this was asked for — "are you
   * getting the referrals accordingly?" — is about the *prospect's* situation,
   * and the only thing that knows that is the writer looking at their
   * headline, title and company (rule 16). An opener is a shape to lean on,
   * so the shape is the greeting and the specific line is written per person.
   */
  return DEFAULT_OPENER_TEMPLATE;
}

/**
 * The offer, in one line a person can read in a chat window on a phone.
 *
 * Built from the one-liner, which is the sentence onboarding already asked
 * for: "what the company sells and to whom" is exactly what somebody who asks
 * "what is this?" wants to know.
 *
 * Both real businesses on this deployment write one-liners well over the
 * limit, and the first version answered that with "Referral Nova — ask me what
 * we do and I will tell you in one line." A placeholder that dodges the
 * question is worse than a short true sentence, and it is the one piece of
 * copy in the product that actually sells the thing.
 *
 * So it is cut at a clause boundary rather than a character count. A comma or
 * a bracket is where a sentence stops being one idea, and stopping there
 * leaves something true and readable — "An AI-powered referral networking
 * platform that matches small businesses." Cutting at ninety characters
 * instead leaves a word in half, arriving from a stranger as a broken send.
 */
function offerFrom(business: BusinessProfile): string {
  const line = (business.oneLiner ?? "").trim().replace(/\s+/g, " ");
  if (!line) return (business.companyName ?? "").slice(0, PITCH_MAX_CHARS);
  if (line.length <= PITCH_MAX_CHARS) return line;

  let head = line.slice(0, PITCH_MAX_CHARS - 1);

  // An aside that never closes. Cutting inside a bracket leaves "(RV & auto
  // dealers, med spas, dentists." — a sentence holding a bracket open, which
  // reads as a message that was interrupted.
  const opened = head.lastIndexOf("(");
  if (opened !== -1 && head.indexOf(")", opened) === -1) head = head.slice(0, opened);

  // The last place this stops being one idea: a clause break, or failing that
  // a word break. Never mid-word.
  const clauseEnd = Math.max(head.lastIndexOf(","), head.lastIndexOf(";"));
  const cut = clauseEnd > 24 ? clauseEnd : head.lastIndexOf(" ");
  const body = (cut > 24 ? head.slice(0, cut) : head).trim().replace(/[,;]$/, "");
  if (body.length <= 24) return (business.companyName ?? "").slice(0, PITCH_MAX_CHARS);
  return `${body}.`;
}

/** How it writes: the shipped baseline, plus this business's own tone. */
function voiceFrom(business: BusinessProfile, baseline: string): string {
  const tone = business.toneOfVoice?.trim();
  return tone ? `${baseline}\n\nHow this business sounds: ${tone}` : baseline;
}

/**
 * Gives an agent to every workspace that has told us about its business and
 * has not got one.
 *
 * Seeding at the moment the Strategy Agent writes the business profile covers
 * a workspace onboarding today and nobody else. Every workspace that onboarded
 * before agents existed — which on this deployment is all of them — would open
 * the agents screen, find it empty, and be handed the blank form this was
 * written to remove.
 *
 * So it is a sweep rather than a hook. It runs at boot and again in nightly
 * maintenance, because repair must never depend on somebody finding a button
 * (rule 8), and "run a strategy again to get an agent" is that button wearing
 * a different hat.
 *
 * Idempotent by the same check the single seed uses, so a workspace that
 * already has one is skipped and running this twice costs two queries.
 */
export async function seedMissingAgents(db: Db, limit = 500): Promise<number> {
  const { data: profiles } = await db
    .from("business_profiles")
    .select("workspace_id, spec, created_by")
    .limit(limit);
  if (!profiles?.length) return 0;

  let seeded = 0;
  for (const profile of profiles) {
    const business = BusinessProfileSchema.safeParse(profile.spec);
    // A profile the schema cannot read is left alone rather than seeded from
    // guesses. An agent built on half a business profile writes to real people
    // from facts nobody checked.
    if (!business.success) continue;

    // The name a prospect reads. Falls back to null rather than to the company
    // name: a message signed with a company reads as a mailshot, which is the
    // one thing the opener exists to avoid.
    let repName: string | null = null;
    if (profile.created_by) {
      const { data: owner } = await db
        .from("profiles")
        .select("full_name")
        .eq("id", profile.created_by)
        .maybeSingle();
      repName = owner?.full_name ?? null;
    }

    try {
      const id = await seedWorkspaceAgent(db, {
        workspaceId: profile.workspace_id,
        userId: profile.created_by ?? null,
        business: business.data,
        repName,
      });
      if (id) seeded += 1;
    } catch (err) {
      // One workspace's failure never stops the sweep. A shared maintenance
      // pass that dies on the first awkward row leaves every workspace after
      // it unseeded, and nothing says which.
      console.error("could not seed an agent for a workspace", {
        workspaceId: profile.workspace_id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return seeded;
}
