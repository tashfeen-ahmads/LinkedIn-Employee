import type { WorkerContext } from "../context.js";
import { workspaceEntitlement } from "../billing.js";
import { writeWorkspacePosts } from "./write-posts.js";

/*
 * A fresh set of posts for every rep, once a week (rule 69).
 *
 * The posts are organic content for the audience's industry, and one of them
 * is this week's news there, built only from real headlines. News a week old
 * is not news, so the set is renewed weekly rather than written once and left.
 * Nothing is published by this: every draft waits for a person, and the
 * overview's Needs you list says they are there.
 *
 * Run from the nightly sweep. A rep is written for only when their newest post
 * is at least `WEEKLY_POSTS_DAYS` old, so a person who pressed "Write posts"
 * on Tuesday is not handed a second set on Wednesday. Unread drafts are
 * replaced, as the button replaces them; a draft somebody edited is their
 * work, and a rep holding one is left alone until they approve or discard it.
 */
export const WEEKLY_POSTS_DAYS = 6;

/** A draft touched more than this after it was written was edited by a person. */
const EDITED_AFTER_MS = 60_000;

export async function writeWeeklyPosts(
  ctx: WorkerContext,
  now: Date = new Date(),
  write: typeof writeWorkspacePosts = writeWorkspacePosts,
): Promise<number> {
  const { db } = ctx;
  const { data: workspaces, error } = await db.from("workspaces").select("id").eq("publish_posts", true);
  if (error) throw new Error(`could not read workspaces: ${error.message}`);

  const cutoff = now.getTime() - WEEKLY_POSTS_DAYS * 86_400_000;
  let written = 0;

  for (const workspace of workspaces ?? []) {
    // A workspace that cannot send is not paying for writing either.
    const entitled = await workspaceEntitlement(db, workspace.id, now);
    if (!entitled?.canSend) continue;

    // Posts are about the people somebody chose to reach. Without an approved
    // strategy there is nobody to write for.
    const { count: approved, error: strategyError } = await db
      .from("customer_profiles")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .not("approved_at", "is", null);
    if (strategyError || !approved) continue;

    const { data: accounts, error: accountError } = await db
      .from("linkedin_accounts")
      .select("user_id")
      .eq("workspace_id", workspace.id)
      .eq("status", "active");
    if (accountError) continue;

    for (const userId of new Set((accounts ?? []).map((a) => a.user_id).filter(Boolean) as string[])) {
      const { data: posts, error: postsError } = await db
        .from("linkedin_posts")
        .select("status, created_at, updated_at")
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      // Unknowable is not "nothing written": a read that failed writes nothing.
      if (postsError) continue;
      const newest = posts?.[0]?.created_at ? Date.parse(posts[0].created_at) : null;
      if (newest !== null && newest > cutoff) continue;
      const edited = (posts ?? []).some(
        (post) =>
          post.status === "draft" && Date.parse(post.updated_at) - Date.parse(post.created_at) > EDITED_AFTER_MS,
      );
      if (edited) continue;

      try {
        const result = await write(ctx, { workspaceId: workspace.id, userId });
        if (result.ok) written += result.written;
      } catch (err) {
        // One rep's failed run must not stop everybody else's week.
        console.error("weekly posts failed", { workspaceId: workspace.id, userId, reason: String(err) });
      }
    }
  }
  return written;
}
