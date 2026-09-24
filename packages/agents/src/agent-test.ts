import {
  fieldsUsed,
  missingFields,
  renderMerge,
  type Agent,
  type BusinessProfile,
  type CustomerProfile,
  type MergeValues,
  type ProspectCandidate,
} from "@le/shared";
import type { AgentContext } from "./client.js";
import { personalizeInvites } from "./targeting.js";

/**
 * Runs an agent against one prospect and shows what it would actually send.
 *
 * The whole reason an agent is worth configuring is being able to see what it
 * says before a stranger does. That has never been possible here: a rep changed
 * a prompt, launched a campaign, and found out from the prospect's reply — or
 * from silence, which is the same thing arriving more slowly.
 *
 * It calls **the real writer**. `personalizeInvites` is what builds a campaign's
 * notes, and a test area that called something else would be a second reading
 * of the same rule — which is how the screen and the send come to disagree, and
 * the screen is always the one somebody believes. If the note this produces is
 * wrong, the note the campaign produces is wrong in the same way.
 *
 * Nothing here can send. It is the one place in this product where the agent
 * writes and no provider call follows.
 */

export interface AgentTestSubject {
  firstName: string;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  headline?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
}

export interface AgentTestResult {
  inviteNote: string | null;
  /** What the note actually leaned on, which is what makes "personalised" checkable. */
  grounding: string[];
  /** Placeholders the copy asked for that this prospect could not fill. */
  fieldsMissing: string[];
  fieldsUsed: string[];
  /** Set instead of the rest when the run could not complete. */
  error: string | null;
}

/**
 * The merge values a test subject provides, in the same shape a real send uses.
 *
 * Built here rather than imported from the worker because the worker owns a
 * database row and this owns a form; what has to match is the *result*, and
 * both go through `renderMerge`.
 */
function valuesFor(subject: AgentTestSubject, repName: string, agent: Agent): MergeValues {
  const values: MergeValues = {
    first_name: subject.firstName,
    last_name: subject.lastName ?? null,
    company: subject.company ?? null,
    title: subject.title ?? null,
    location: subject.location ?? null,
    rep_name: agent.fromName?.trim() || repName,
  };
  return values;
}

/**
 * What a template would look like for this person, before any model is called.
 *
 * Cheap and immediate, and it answers the question a rep asks most often —
 * "does `{{company}}` actually fill in for these people?" — without spending a
 * model call or waiting. An unresolved placeholder reaching a prospect is the
 * failure this exists to catch, and it is catchable without asking a model
 * anything.
 */
export function previewTemplate(
  template: string,
  subject: AgentTestSubject,
  repName: string,
  agent: Agent,
): { rendered: string; used: string[]; missing: string[] } {
  const values = valuesFor(subject, repName, agent);
  return {
    rendered: renderMerge(template, values),
    used: fieldsUsed(template).slice(),
    missing: missingFields(template, values).slice(),
  };
}

/**
 * Asks the agent for the connection note it would send this person.
 *
 * One prospect, because that is what a rep is checking. `personalizeInvites`
 * works in batches and matches its answers to people by provider id, never by
 * position (rule 16) — so a batch of one is matched exactly as a batch of fifty
 * is, and the test exercises that matching rather than stepping around it.
 */
export async function testAgentInvite(
  ctx: AgentContext,
  input: {
    agent: Agent;
    business: BusinessProfile;
    profile: CustomerProfile;
    repName: string;
    /** The approved openers this agent owns, its own first. */
    openers: string[];
    subject: AgentTestSubject;
  },
): Promise<AgentTestResult> {
  const providerId = "agent-test-subject";
  const candidate: ProspectCandidate = {
    providerId,
    firstName: input.subject.firstName,
    lastName: input.subject.lastName ?? null,
    company: input.subject.company ?? null,
    title: input.subject.title ?? null,
    headline: input.subject.headline ?? null,
    location: input.subject.location ?? null,
    linkedinUrl: input.subject.linkedinUrl ?? null,
  } as ProspectCandidate;

  try {
    const written = await personalizeInvites(ctx, {
      business: input.business,
      profile: input.profile,
      // The agent's own from-name wins, because that is the name the prospect
      // reads and the reason the field exists.
      repName: input.agent.fromName?.trim() || input.repName,
      campaignAngle: input.agent.playbook.objective || "",
      hooks: input.openers,
      prospects: [candidate],
    });

    const note = written.get(providerId);
    if (!note?.note?.trim()) {
      // Reported rather than shown as an empty box. A writer that answered for
      // nobody is exactly what rule 27 says degrades a campaign silently, and
      // the test area is where that should be visible.
      return {
        inviteNote: null,
        grounding: [],
        fieldsUsed: [],
        fieldsMissing: [],
        error: "The writer returned no note for this person.",
      };
    }

    const values = valuesFor(input.subject, input.repName, input.agent);
    return {
      inviteNote: renderMerge(note.note, values),
      // Empty grounding is reported, never hidden (rule 16): a note that cites
      // nothing looks exactly like one that cites everything.
      grounding: note.grounding ?? [],
      fieldsUsed: fieldsUsed(note.note).slice(),
      fieldsMissing: missingFields(note.note, values).slice(),
      error: null,
    };
  } catch (err) {
    // Handed back verbatim. A model refusal or a rate limit is the single most
    // useful sentence a rep can be shown here, and it used to go to a log on a
    // host the person pressing the button cannot reach.
    return {
      inviteNote: null,
      grounding: [],
      fieldsUsed: [],
      fieldsMissing: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
