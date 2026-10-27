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

import { POST_MAX_CHARS } from "./constants.js";
import { isWithinWorkingHours, type WorkingHours } from "./time.js";

/**
 * The hours a post may land in, when nobody named a time.
 *
 * A post is read by whoever is scrolling when it appears, so *when* is part of
 * whether it worked at all — and a post appearing on a real professional's
 * profile at four in the morning their time reads as a machine posting for
 * them, which is the one impression this product cannot afford to give on the
 * account it exists to protect.
 *
 * So an unscheduled post waits for the rep's own working hours. A post with an
 * explicit `scheduled_for` goes at that time whatever it is: they asked.
 */
export interface PostWindow {
  hours: WorkingHours;
  /** IANA zone. `profiles.timezone`, not the server's. */
  timezone: string;
}

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
export function mayPublish(
  post: PostRow,
  now: Date = new Date(),
  /**
   * The rep's posting hours, when the caller knows them.
   *
   * Optional because the row-only checks are worth making before anything is
   * read from another table — a draft nobody approved should not cost a query
   * against `linkedin_accounts`. The sweep asks twice for exactly that reason,
   * and the screen asks once with the window, so both say the same thing about
   * the same row (the habit rule 21 states for `describePacing`).
   */
  window?: PostWindow,
): PostVerdict {
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
    // Past its time, and the rep chose that time. The window below is what
    // "publish it when you can" means, not an override of an instruction.
    if (Number.isFinite(due)) return { send: true };
  }

  if (window && !isWithinWorkingHours(now, window.hours, window.timezone)) {
    // Retryable, and the most ordinary hold there is: the words are approved
    // and the next sweep inside working hours sends them. Written off as a
    // failure this would be a post that never went out because it was approved
    // in the evening.
    return { send: false, reason: "waiting for your posting hours", retry: true };
  }

  return { send: true };
}

/*
 * The graphic published with a post (migration 0060).
 *
 * One line on a designed card, read at a glance in a phone's feed. Short
 * enough to set large, and held to the same lines as the post itself: no
 * link, no hashtag, no emoji, no placeholder. Over-long lines are refused
 * rather than cut, because half a sentence set in 80-point type is worse on a
 * real professional's profile than no picture at all.
 */
export const GRAPHIC_HEADLINE_MAX_CHARS = 90;
export const GRAPHIC_STYLES = ["brand", "light", "dark"] as const;
export type GraphicStyle = (typeof GRAPHIC_STYLES)[number];

export function isGraphicStyle(value: unknown): value is GraphicStyle {
  return typeof value === "string" && (GRAPHIC_STYLES as readonly string[]).includes(value);
}

/** What is wrong with a graphic's headline, as sentences somebody can act on. */
export function graphicHeadlineProblems(headline: string): string[] {
  const text = headline.trim();
  const problems: string[] = [];
  if (!text) return ["The graphic needs a headline."];
  if (text.length > GRAPHIC_HEADLINE_MAX_CHARS) {
    problems.push(`The headline is ${text.length} characters. Keep it to ${GRAPHIC_HEADLINE_MAX_CHARS} so it reads at a glance.`);
  }
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|co|net|org|ai|app)\b/i.test(text)) {
    problems.push("The headline has a link. A graphic never carries one.");
  }
  if (/#\w/.test(text)) problems.push("The headline has a hashtag.");
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push("The headline has an emoji.");
  if (/\{\{|\[[A-Z][a-z]+\]/.test(text)) problems.push("The headline has a placeholder in it.");
  return problems;
}

/**
 * A headline for a post that came without one: its first sentence, when that
 * sentence is short enough to set whole. Never a cut-down sentence, so a post
 * that opens long gets no graphic until somebody writes the line.
 */
export function fallbackGraphicHeadline(body: string): string | null {
  const first = body.trim().split(/\n/)[0]?.trim() ?? "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(first)?.[1] ?? first;
  return sentence && graphicHeadlineProblems(sentence).length === 0 ? sentence : null;
}
