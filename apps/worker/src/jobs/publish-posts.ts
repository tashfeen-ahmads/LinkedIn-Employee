import { mayPublish, type PostRow } from "@le/shared";
import { recordEvent, type WorkerContext } from "../context.js";

/**
 * Posts that a person approved, sent to LinkedIn.
 *
 * Deliberately a sweep over approved rows rather than a job queued when
 * somebody presses Approve. A queued job carries the decision with it, and by
 * the time it runs the row may have been edited — which clears the approval in
 * a trigger — or already published by an earlier run. Reading the row at send
 * time means the approval that is checked is the one that exists now, which is
 * the same reason the rate limiter is re-checked immediately before an
 * invitation rather than when it was scheduled (rule 1).
 *
 * Nothing here decides whether a post is good. `mayPublish` decides whether it
 * may go, and it is in `@le/shared` because the screen has to say the same
 * thing: a row the sweep will not send must not sit on the page looking as
 * though it is about to.
 */
export async function publishApprovedPosts(
  ctx: WorkerContext,
  now: Date = new Date(),
  limit = 10,
): Promise<{ published: number; held: number; failed: number }> {
  const { data: rows } = await ctx.db
    .from("linkedin_posts")
    .select("id, workspace_id, user_id, body, status, approved_at, scheduled_for, published_at")
    .eq("status", "approved")
    .order("scheduled_for", { ascending: true, nullsFirst: true })
    .limit(limit);

  let published = 0;
  let held = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const verdict = mayPublish(row as PostRow, now);
    if (!verdict.send) {
      // A post waiting for its time is not a failure. Written off as one it
      // would never go out, and the rep would find a "failed" row whose only
      // fault was being early.
      if (verdict.retry) {
        held += 1;
        continue;
      }
      failed += 1;
      await ctx.db
        .from("linkedin_posts")
        .update({ status: "failed", error: verdict.reason })
        .eq("id", row.id);
      continue;
    }

    /*
     * The account is read here rather than carried, for the same reason the
     * row is: a rep who disconnected LinkedIn this morning must not have a
     * post go out against a stale account id.
     */
    const { data: account } = await ctx.db
      .from("linkedin_accounts")
      .select("provider_account_id, status")
      .eq("workspace_id", row.workspace_id)
      .eq("user_id", row.user_id)
      .maybeSingle();

    // A row that says `active` while holding no provider id is the state a
    // half-finished connection leaves behind, and posting against it would
    // be posting to nobody.
    if (!account || account.status !== "active" || !account.provider_account_id) {
      // Held, not failed: the post is fine, the account is not, and the rep
      // reconnecting should be enough to send it without re-approving.
      held += 1;
      continue;
    }

    const result = await ctx.linkedin.publishPost({
      accountId: account.provider_account_id,
      text: row.body,
    });

    if (!result.ok) {
      failed += 1;
      await ctx.db
        .from("linkedin_posts")
        // The provider's own words, verbatim. "422: ..." is the single most
        // useful sentence in the flow (rule 25).
        .update({ status: "failed", error: result.error ?? "the provider refused the post" })
        .eq("id", row.id);
      await recordEvent(ctx.db, {
        workspaceId: row.workspace_id,
        name: "post.failed",
        subjectType: "linkedin_post",
        subjectId: row.id,
        payload: { error: result.error },
      });
      continue;
    }

    published += 1;
    await ctx.db
      .from("linkedin_posts")
      .update({
        status: "published",
        published_at: now.toISOString(),
        provider_post_id: result.providerId ?? null,
        error: null,
      })
      .eq("id", row.id);
    await recordEvent(ctx.db, {
      workspaceId: row.workspace_id,
      name: "post.published",
      subjectType: "linkedin_post",
      subjectId: row.id,
      payload: { providerPostId: result.providerId ?? null },
    });
  }

  return { published, held, failed };
}
