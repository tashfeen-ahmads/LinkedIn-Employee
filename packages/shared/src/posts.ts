/**
 * Whether a post may reach LinkedIn.
 *
 * Every other thing this product sends goes to one named person. A post goes
 * to everyone who follows the rep, stays on their profile, and is the first
 * thing a prospect reads when they look the sender up after an invitation
 * arrives. The reply gate has an autonomy setting because an unanswered
 * pricing question on a Friday is a lead lost (rule 41); there is no
 * equivalent cost here. A post that waits until Monday for somebody to read it
 * has lost nothing. A post that goes out unread is on a real professional's
 * public profile under their own name, and the only remedy is deleting it
 * after people have seen it.
 *
 * So this is deliberately a list of reasons to refuse, evaluated in code
 * rather than asked for in a prompt — `callStructured` casts rather than
 * parses (rule 40), so a model told "never post without approval" has been
 * told, not constrained.
 */

/** LinkedIn refuses a post above this, and truncating one is not an option. */
export const POST_MAX_CHARS = 3000;

export type PostRow = {
  body: string;
  status: string;
  approved_at: string | null;
  scheduled_for: string | null;
  published_at: string | null;
};

export type PostVerdict =
  | { send: true }
  | { send: false; reason: string; retry: boolean };

/**
 * `retry` separates "not yet" from "never".
 *
 * A post waiting for its scheduled time is not a failure and must not be
 * written off as one; a post nobody approved is not going to become approved
 * by being looked at again in five minutes. Reported identically, the sweep
 * either burns through its queue retrying dead rows or quietly drops live
 * ones — the same distinction rule 40 draws between holding a follow-up and
 * failing it.
 */
export function mayPublish(post: PostRow, now: Date = new Date()): PostVerdict {
  if (post.published_at || post.status === "published") {
    // Not an error, and not a second publish. LinkedIn has no idempotency key
    // here, so a duplicate is two posts on a real profile minutes apart.
    return { send: false, reason: "already published", retry: false };
  }
  if (post.status === "failed") {
    return { send: false, reason: "a previous attempt failed; edit it and approve again", retry: false };
  }
  if (!post.approved_at || post.status !== "approved") {
    return { send: false, reason: "nobody has approved this post", retry: false };
  }

  const body = post.body?.trim() ?? "";
  if (!body) {
    // An empty post is a real thing to guard: the trigger clears approval when
    // the body changes, but nothing stops somebody approving a blank one.
    return { send: false, reason: "the post is empty", retry: false };
  }
  if (body.length > POST_MAX_CHARS) {
    // Dropped, never truncated. A post cut mid-sentence reaches a professional
    // audience under a real name, which is worse than not posting — the same
    // reason `PITCH_MAX_CHARS` drops rather than trims.
    return {
      send: false,
      reason: `${body.length} characters; LinkedIn's limit is ${POST_MAX_CHARS}`,
      retry: false,
    };
  }

  if (post.scheduled_for) {
    const due = Date.parse(post.scheduled_for);
    if (Number.isFinite(due) && due > now.getTime()) {
      return { send: false, reason: `scheduled for ${post.scheduled_for}`, retry: true };
    }
  }

  return { send: true };
}
