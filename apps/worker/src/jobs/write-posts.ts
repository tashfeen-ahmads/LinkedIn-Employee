import { writePosts, POST_PROMPT_VERSION } from "@le/agents";
import { loadBusinessProfile } from "@le/db";
import { BusinessProfileSchema } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

export interface WritePostsInput {
  workspaceId: string;
  userId: string;
  /** What the person asked to change about the drafts they are looking at. */
  instruction?: string;
  /**
   * Which business speaks, for a workspace that runs more than one.
   *
   * A post carries a voice and a claim, and a workspace running a cleaning
   * company and an estate agency must not post one's copy in the other's voice.
   * Absent falls back to the workspace's first profile, which is every
   * workspace that has only ever had one.
   */
  businessProfileId?: string | null;
}

export type WritePostsResult =
  | { ok: true; written: number; replaced: number; droppedForLinks: number }
  | { ok: false; reason: string };

/**
 * Writes drafts for the rep's own profile, on the request thread.
 *
 * Synchronous rather than queued, for `writeWorkspacePitch`'s reason: a queued
 * run leaves whoever pressed the button looking at an unchanged page, which is
 * indistinguishable from a button that did nothing (rule 25). It takes a few
 * seconds and its output is the whole point of the click.
 *
 * It approves nothing. Every row comes back with `approved_at` null, and the
 * screen asks somebody to read it — and here that matters more than anywhere
 * else in the product, because the remedy for a post that should not have gone
 * out is deleting it after people have read it.
 */
export async function writeWorkspacePosts(
  ctx: WorkerContext,
  input: WritePostsInput,
): Promise<WritePostsResult> {
  const profileRow = await loadBusinessProfile(
    ctx.db,
    input.workspaceId,
    input.businessProfileId ?? undefined,
  );

  const parsed = BusinessProfileSchema.safeParse(profileRow?.spec);
  if (!parsed.success) {
    // Named rather than guessed at. Without a business profile the agent would
    // write about a company it knows nothing about — fluent, entirely
    // invented, and then offered for approval as though it came from somewhere.
    return {
      ok: false,
      reason: "Tell us what you do first — posts are written from your business profile.",
    };
  }

  const [{ data: knowledge }, { data: rep }, { data: existing }, { data: audiences }] =
    await Promise.all([
      ctx.db
        .from("knowledge_documents")
        .select("title, content")
        .eq("workspace_id", input.workspaceId)
        .limit(20),
      ctx.db.from("profiles").select("full_name").eq("id", input.userId).maybeSingle(),
      // Only this person's unapproved drafts. A post sits on one profile, so
      // two reps in a workspace each have their own set and one pressing the
      // button must not replace the other's.
      ctx.db
        .from("linkedin_posts")
        .select("id, body, approved_at, status")
        .eq("workspace_id", input.workspaceId)
        .eq("user_id", input.userId)
        .eq("status", "draft"),
      // The segments somebody approved. A post written for nobody in particular
      // is written for LinkedIn in general, which is nobody.
      ctx.db
        .from("customer_profiles")
        .select("spec")
        .eq("workspace_id", input.workspaceId)
        .not("approved_at", "is", null)
        .limit(5),
    ]);

  const segments = (audiences ?? [])
    .map((row) => {
      const spec = row.spec as { name?: unknown; summary?: unknown } | null;
      const name = typeof spec?.name === "string" ? spec.name : null;
      const summary = typeof spec?.summary === "string" ? spec.summary : null;
      return name ? (summary ? `${name} — ${summary}` : name) : null;
    })
    .filter((line): line is string => Boolean(line));

  const agents = ctx.agentsFor(input.workspaceId);
  const set = await writePosts(agents, {
    business: parsed.data,
    knowledge: knowledge ?? [],
    repName: rep?.full_name ?? undefined,
    audiences: segments,
    instruction: input.instruction?.trim() || undefined,
    // Only when they are asking for a change. A blank instruction with the old
    // drafts attached invites a light edit of them, and "write me new ones"
    // returns the same three with two words moved.
    current: input.instruction?.trim() ? (existing ?? []).map((row) => row.body) : undefined,
  });

  /*
   * Unapproved drafts are replaced; approved and published rows are untouched.
   *
   * The published ones are the record of what went out and rewriting them would
   * make this table disagree with LinkedIn. The approved ones are words a
   * person has already read and said yes to, and deleting those would quietly
   * un-approve a decision somebody made — the inverse of the trigger that
   * clears approval when the words change.
   */
  const replaced = (existing ?? []).length;
  const { error: cleared } = await ctx.db
    .from("linkedin_posts")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("status", "draft")
    .is("approved_at", null);
  if (cleared) throw new Error(`could not clear the old drafts: ${cleared.message}`);

  const rows = set.drafts.map((draft) => ({
    workspace_id: input.workspaceId,
    user_id: input.userId,
    business_profile_id: profileRow?.id ?? null,
    body: draft.body,
    facts_used: draft.factsUsed as never,
    status: "draft" as const,
    // Explicit, never merely absent: these are words nobody has read yet.
    approved_at: null,
    approved_by: null,
  }));
  const { error } = await ctx.db.from("linkedin_posts").insert(rows);
  if (error) throw new Error(`could not save the drafts: ${error.message}`);

  await recordEvent(ctx.db, {
    workspaceId: input.workspaceId,
    name: "post.written",
    actorUserId: input.userId,
    subjectType: "workspace",
    subjectId: input.workspaceId,
    payload: {
      promptVersion: POST_PROMPT_VERSION,
      written: rows.length,
      replaced,
      longest: rows.reduce((max, row) => Math.max(max, row.body.length), 0),
      rewrite: Boolean(input.instruction?.trim()),
      audiencesUsed: segments.length,
      // A writer that keeps producing links is a prompt that needs changing,
      // and a silent filter is how that goes unnoticed for a month.
      droppedForLinks: set.droppedForLinks,
      droppedForLength: set.droppedForLength,
      // Empty grounding is reported rather than hidden — rule 16's habit. A
      // post citing nothing looks exactly like one citing everything, and the
      // difference is whether this rep's whole network is about to be told
      // something nobody can check.
      ungrounded: set.drafts.filter((draft) => draft.factsUsed.length === 0).length,
    },
  }).catch((err) => console.error("could not record post.written", err));

  return { ok: true, written: rows.length, replaced, droppedForLinks: set.droppedForLinks };
}
