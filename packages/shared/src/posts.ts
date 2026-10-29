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
  /**
   * When this rep's profile last had a post published, or null for never.
   * Absent means the caller did not look, and spacing is not checked.
   */
  lastPublishedAt?: string | null;
}

/**
 * One post on a profile every two days, at most (rule 69).
 *
 * Approving three drafts in an evening published all three the next morning in
 * the same minute: three posts at once on a real professional's profile reads
 * as software, and LinkedIn shows each to fewer people when they crowd each
 * other. A scheduled time is honoured too, but never inside the gap.
 */
export const POST_SPACING_DAYS = 2;
export const POST_SPACING_MS = POST_SPACING_DAYS * 86_400_000;

/**
 * When each approved post can go out, in the order the sweep sends them:
 * unscheduled first, then by scheduled time, each at least `POST_SPACING_MS`
 * after the one before and after the last one published. For the screen, so a
 * queue of three says three dates instead of "within a quarter of an hour".
 */
export function projectPostTimes(
  rows: ReadonlyArray<{ id: string; scheduled_for: string | null; approved_at: string | null }>,
  lastPublishedAt: string | null,
  now: Date = new Date(),
  /**
   * The rep's posting hours. An unscheduled post waits for them, so its date
   * is moved to the next opening; a scheduled one goes at its time (or the
   * end of the gap) whatever the hours say, exactly as `mayPublish` decides.
   */
  window?: Pick<PostWindow, "hours" | "timezone">,
): Map<string, Date> {
  const order = [...rows].sort((a, b) => {
    const sa = a.scheduled_for ? Date.parse(a.scheduled_for) : -Infinity;
    const sb = b.scheduled_for ? Date.parse(b.scheduled_for) : -Infinity;
    if (sa !== sb) return sa - sb;
    return Date.parse(a.approved_at ?? "") - Date.parse(b.approved_at ?? "");
  });
  const out = new Map<string, Date>();
  let previous = lastPublishedAt ? Date.parse(lastPublishedAt) : Number.NEGATIVE_INFINITY;
  for (const row of order) {
    const scheduled = row.scheduled_for ? Date.parse(row.scheduled_for) : Number.NEGATIVE_INFINITY;
    let at = Math.max(now.getTime(), Number.isFinite(scheduled) ? scheduled : -Infinity, previous + POST_SPACING_MS);
    if (!row.scheduled_for && window) at = nextOpening(at, window);
    out.set(row.id, new Date(at));
    previous = at;
  }
  return out;
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
  | { send: false; reason: string; retry: boolean; notBefore?: string };

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

  // Spacing first, so a scheduled time inside the gap waits for the gap too.
  if (window?.lastPublishedAt) {
    const last = Date.parse(window.lastPublishedAt);
    if (Number.isFinite(last) && now.getTime() - last < POST_SPACING_MS) {
      const notBefore = new Date(last + POST_SPACING_MS).toISOString();
      return {
        send: false,
        reason: `one post every ${POST_SPACING_DAYS} days on your profile, so this waits until ${notBefore}`,
        retry: true,
        notBefore,
      };
    }
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

/** The first quarter hour at or after `at` inside the rep's posting hours, within a fortnight. */
function nextOpening(at: number, window: Pick<PostWindow, "hours" | "timezone">): number {
  const step = 15 * 60_000;
  for (let t = at, end = at + 14 * 86_400_000; t <= end; t += step) {
    if (isWithinWorkingHours(new Date(t), window.hours, window.timezone)) return t;
  }
  return at;
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

/*
 * A post that sells, or reads as software.
 *
 * Posts are organic content for the audience's industry (rule 69). The prompt
 * says so, and `callStructured` casts rather than parses, so the lines that
 * turn a helpful post into an advert are checked here: talking about what we
 * do, a call to action, engagement bait, emoji and dashes.
 */
const POST_PITCH = [
  /\b(we|i) (help|work with|partner with|specialise in|specialize in)\b/i,
  /\bour (clients?|customers?|platform|product|service|services|solution|tool|team|agency|firm)\b/i,
  /\b(book|schedule|grab|hop on) (a|an|your) (call|demo|meeting|consultation)\b/i,
  /\b(dm|message) me\b|\blink in (the )?(comments|bio)\b|\breach out\b|\bsign up\b|\bfree trial\b/i,
  /\bcomment (yes|below|["'])|\blet me know (below|in the comments)\b|\b(thoughts|agree)\?\s*$/im,
];

export function postProblems(body: string): string[] {
  const problems: string[] = [];
  if (POST_PITCH.some((pattern) => pattern.test(body))) {
    problems.push("It pitches or asks for something. A post is useful content for the reader's industry, never an advert.");
  }
  if (/\p{Extended_Pictographic}/u.test(body)) problems.push("It has an emoji.");
  if (/[–—]/.test(body)) problems.push("It has a dash.");
  return problems;
}
