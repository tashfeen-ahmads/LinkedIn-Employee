import {
  POST_MAX_CHARS,
  PostDraftSetSchema,
  extractLinks,
  postProblems,
  tidyVoice,
  type BusinessProfile,
  type PostDraftSet,
} from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { renderKnowledge } from "./knowledge.js";
import { POST_PROMPT_VERSION, POST_SYSTEM } from "./prompts/post.js";

export interface PostInput {
  business: BusinessProfile;
  /** The customer's own words. The only place a specific claim may come from. */
  knowledge: Array<{ title: string; content: string }>;
  /** Whose profile it appears on, so the voice is a person's not a brand's. */
  repName?: string;
  /**
   * The segments this workspace is actually pursuing.
   *
   * A post is read by whoever follows the rep, but it is written *for* the
   * people the campaigns are about — that is what makes it worth anything to a
   * prospect checking the profile behind an invitation. Without them the agent
   * writes to LinkedIn in general, which is nobody.
   */
  audiences?: string[];
  /**
   * The industries those segments work in, which is what the posts are about.
   * A post is organic content for the audience's own world, never an advert
   * for the business that wrote it.
   */
  industries?: string[];
  /** What those segments struggle with, in their words. Material, not a script. */
  pains?: string[];
  /**
   * This week's real headlines in those industries (`industryNews`), the only
   * source an industry update may draw on. Absent, no update is written.
   */
  news?: Array<{ title: string; source: string; date: string }>;
  /** What the person editing the last set asked for. */
  instruction?: string;
  /** The posts being rewritten, when there are any. */
  current?: string[];
}

export interface PostResult extends PostDraftSet {
  /**
   * Drafts thrown away for carrying a URL, and how many.
   *
   * Reported rather than swallowed, because a writer that keeps producing links
   * is a prompt that needs changing and a silent filter is how that goes
   * unnoticed for a month.
   */
  droppedForLinks: number;
  droppedForLength: number;
  /** Drafts that pitched, carried an emoji, or invented a week's news. */
  droppedForPitch: number;
}

/**
 * Writes drafts for the rep's own profile. It approves none of them.
 *
 * `approved_at` is set on `/app/posts` and nowhere else, exactly as rule 9
 * holds for the customer profiles the Strategy Agent writes and rule 40 for
 * pitches. The stakes are higher here than for either: a post goes to everyone
 * who follows the rep and stays on their profile, and the only remedy for one
 * that should not have gone out is deleting it after people have read it.
 */
export async function writePosts(ctx: AgentContext, input: PostInput): Promise<PostResult> {
  const set = await callStructured(ctx, {
    agent: "post",
    // The writer, not the classifier: these words sit on a real
    // professional's public profile under their own name.
    model: ctx.client.models.writer,
    promptVersion: POST_PROMPT_VERSION,
    schema: PostDraftSetSchema,
    // Identical for every workspace, so it caches across every post run rather
    // than only within one.
    system: [{ text: POST_SYSTEM, cached: true }],
    userContent: [
      `Business profile:\n${JSON.stringify(input.business, null, 2)}`,
      input.repName ? `\nThe post appears on ${input.repName}'s own profile, in the first person.` : "",
      input.audiences?.length
        ? `\nThe people this business is pursuing, and who the post is therefore written for:\n${input.audiences
            .map((audience) => `- ${audience}`)
            .join("\n")}`
        : "",
      input.industries?.length ? `\nTheir industries:\n${input.industries.map((i) => `- ${i}`).join("\n")}` : "",
      input.pains?.length ? `\nWhat they struggle with:\n${input.pains.map((p) => `- ${p}`).join("\n")}` : "",
      input.news?.length
        ? `\nThis week's news in their industries (the only news you may use; name each source by publication):\n${input.news
            .map((item) => `- ${item.title} (${item.source}, ${item.date})`)
            .join("\n")}`
        : "\nNo news was supplied this week, so do not write an industry_update.",
      `\nBackground on the professional's own field (for context and facts only, never to pitch):\n${renderKnowledge(input.knowledge)}`,
      // A rewrite is shown what it is rewriting. Without it, "make it shorter"
      // produces a different post that happens to be short, and the one the
      // person actually liked is gone.
      input.current?.length
        ? `\nThe current drafts, which you are rewriting:\n${input.current
            .map((body) => `---\n${body}`)
            .join("\n")}`
        : "",
      input.instruction ? `\nWhat they asked you to change:\n"""\n${input.instruction}\n"""` : "",
      "\nWrite the posts.",
    ]
      .filter(Boolean)
      .join("\n"),
    // Writing prose from material somebody else selected. The judgement is in
    // the prompt and the knowledge base; deeper reasoning here buys a longer
    // path to the same paragraph.
    effort: "low",
    maxTokens: 8000,
  });

  /*
   * Both checks are here rather than left to the schema.
   *
   * `callStructured` casts its result; it does not parse it. The schema goes to
   * the provider to shape the JSON, and a provider's structured-output subset
   * enforces the shape — not `maxLength` on a string. So `.max()` in the schema
   * is documentation for the model and nothing else. That is the same hole that
   * sent a 222-character connection note to LinkedIn and had the invitation
   * refused (rule 40).
   *
   * Dropped rather than trimmed, in both cases. A post cut at 3,000 characters
   * ends mid-sentence on a real professional's profile; a post with its URL
   * excised reads as a broken promise — "there's a link below" with nothing
   * below it — which is rule 30's argument for holding rather than stripping.
   */
  // Meaning-preserving tidying first (a dash becomes a comma), then the
  // checks: what still pitches, carries an emoji, or claims this week's news
  // when none was supplied is dropped rather than offered for approval.
  const tidied = set.drafts.map((draft) => ({ ...draft, body: tidyVoice(draft.body) }));
  const short = tidied.filter((draft) => draft.body.trim().length <= POST_MAX_CHARS);
  const linkless = short.filter((draft) => extractLinks(draft.body).length === 0);
  const clean = linkless.filter(
    (draft) =>
      postProblems(draft.body).length === 0 && (draft.format !== "industry_update" || Boolean(input.news?.length)),
  );

  if (clean.length === 0) {
    // Thrown, not returned empty: a run that produced nothing usable has to be
    // recorded and retried, and an empty set handed back looks on screen like
    // a writer that had nothing to say.
    throw new Error(
      `post: every draft came back unusable: ${set.drafts.length - short.length} over ${POST_MAX_CHARS} characters, ${short.length - linkless.length} carrying a link, ${linkless.length - clean.length} pitching or off format`,
    );
  }

  return {
    drafts: clean,
    droppedForLinks: short.length - linkless.length,
    droppedForLength: set.drafts.length - short.length,
    droppedForPitch: linkless.length - clean.length,
  };
}
