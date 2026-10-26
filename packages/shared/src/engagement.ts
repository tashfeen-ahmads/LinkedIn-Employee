import { LINKEDIN_LIMITS } from "./constants.js";
import { containsLink } from "./cta.js";
import { voiceProblems } from "./voice.js";

/**
 * Liking and commenting on prospects' posts (rule 68), the parts that are
 * decided in code rather than by a model.
 *
 * LinkedIn's 2026 policy singles out automated comments, and what gets an
 * account flagged is generic praise, bursts and many actions on one person.
 * So a comment has to name something only that post says, it is checked here
 * as every other message is (rule 66), and the posts worth touching at all are
 * chosen here: recent, the person's own words, nothing anybody would be hurt
 * to see a machine respond to.
 */

/** The phrases that make a comment read like a bot, whatever else it says. */
export const GENERIC_COMMENT_PHRASES = [
  "great post",
  "great share",
  "great insights",
  "great insight",
  "thanks for sharing",
  "thank you for sharing",
  "love this",
  "well said",
  "so true",
  "spot on",
  "couldn't agree more",
  "could not agree more",
  "very insightful",
  "food for thought",
  "this is gold",
  "100%",
  "congrats",
  "congratulations",
];

/**
 * A post nobody should see a machine respond to: grief, illness, losing a job,
 * politics, war. Errs towards skipping, because a missed like costs nothing
 * and a cheerful comment under a bereavement costs the rep their name.
 */
const SENSITIVE = [
  /\b(passed away|passing of|funeral|condolences|rest in peace|\brip\b|bereave|grief|grieving|in loving memory)\b/i,
  /\b(cancer|diagnos(is|ed)|chemo|hospital|surgery|illness|mental health)\b/i,
  /\b(laid off|layoffs?|let go|lost my job|redundan(t|cy)|open to work|job ?search)\b/i,
  /\b(election|vote|voting|democrat|republican|trump|biden|harris|parliament|politic)/i,
  /\b(war|gaza|ukraine|israel|palestin|shooting|attack|tragedy|disaster)\b/i,
];

export function sensitivePost(text: string): boolean {
  return SENSITIVE.some((pattern) => pattern.test(text));
}

export interface PostCandidate {
  socialId: string;
  text: string;
  postedAt: string | null;
  isRepost: boolean;
  canReact: boolean;
  canComment: boolean;
}

/**
 * The one post worth engaging with, or null.
 *
 * Their own words (never a repost), recent enough that a like does not read
 * as somebody scrolling a stranger's history, something LinkedIn lets the
 * account react to, and nothing sensitive.
 */
export function choosePost<T extends PostCandidate>(posts: T[], now: Date = new Date()): T | null {
  const maxAgeMs = LINKEDIN_LIMITS.engagePostMaxAgeDays * 86_400_000;
  for (const post of posts) {
    if (post.isRepost || !post.canReact) continue;
    if (!post.postedAt) continue;
    const age = now.getTime() - Date.parse(post.postedAt);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) continue;
    if (!post.text.trim() || sensitivePost(post.text)) continue;
    return post;
  }
  return null;
}

/** Whether a post has enough of the person's own words to comment on honestly. */
export function worthCommentingOn(post: PostCandidate): boolean {
  return post.canComment && post.text.trim().split(/\s+/).length >= 25;
}

/**
 * What is wrong with a comment, as sentences a writer can act on. Empty when
 * it may be posted.
 *
 * `grounding` is the phrase from the post the comment responds to, and it has
 * to be in the post: an empty or invented one is a comment about nothing in
 * particular, which is the comment LinkedIn's policy is written against.
 */
export function commentProblems(
  comment: string,
  input: { postText: string; grounding: string; companyName?: string | null; productNames?: string[] },
): string[] {
  const problems = voiceProblems(comment, "comment");
  const lower = comment.toLowerCase().replace(/[‘’]/g, "'");
  const grounding = input.grounding.trim().toLowerCase();
  const post = input.postText.toLowerCase().replace(/\s+/g, " ");
  if (grounding.split(/\s+/).filter(Boolean).length < 3 || !post.includes(grounding.replace(/\s+/g, " "))) {
    problems.push("It does not respond to anything specific in the post. Pick a phrase they actually wrote and respond to that.");
  }
  for (const phrase of GENERIC_COMMENT_PHRASES) {
    if (lower.includes(phrase)) problems.push(`It says "${phrase}", which is what a bot writes under every post.`);
  }
  // A bare domain counts too: "see acme.com" is a link to a reader.
  if (containsLink(comment) || /\b[a-z0-9-]+\.(com|io|co|net|org|ai|app|dev|biz|us|uk)\b/i.test(comment)) {
    problems.push("It has a link. A comment never carries one.");
  }
  for (const name of [input.companyName, ...(input.productNames ?? [])]) {
    if (name && name.trim().length > 2 && lower.includes(name.trim().toLowerCase())) {
      problems.push("It names the company or the product. A comment never pitches.");
    }
  }
  if (/\b(dm|message) me\b|\blet'?s (connect|chat|talk)\b|\b(book|hop on|jump on|grab) a (call|meeting|demo)\b/i.test(comment)) {
    problems.push("It asks them to talk or meet. A comment responds to the post and nothing else.");
  }
  return problems;
}
