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
];

/*
 * A comment that sells.
 *
 * The first live comments named no product and still read as outreach: "Which
 * metric matters more to you, time saved or revenue?", "Do you warm up from
 * platform domains or users' own sending domains?". A question under
 * somebody's post is a discovery call in public, and "we help teams like
 * yours" is the pitch with the company name left off. A comment is a person
 * reacting to a post and nothing more, so neither is allowed, checked here
 * because the prompt saying so is not what makes it true (rule 66).
 */
const PITCH_IN_COMMENT = [
  /\b(i|we) (help|work with|support|partner with|specialise in|specialize in)\b/i,
  /\bour (clients?|customers?|team|company|product|service|services|platform|tool|solution|agency|firm)\b/i,
  /\b(at|with) my (company|agency|firm)\b/i,
  /\b(happy|glad) to (help|share|chat|walk you through)\b/i,
  /\b(reach out|feel free to|if you ever need|let me know if)\b/i,
];

/**
 * The reasons a comment sells rather than reacts, or none. Run on every
 * comment the writer returns and again on a queued one immediately before it
 * is posted, so a comment written by an older prompt is held to the same line.
 */
export function commentPitchProblems(comment: string): string[] {
  const problems: string[] = [];
  if (comment.includes("?")) {
    problems.push("It asks a question. A comment reacts to the post in a sentence or two and asks nothing.");
  }
  if (PITCH_IN_COMMENT.some((pattern) => pattern.test(comment))) {
    problems.push("It talks about what you or your company do. A comment is about their post, never your work.");
  }
  return problems;
}

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
  return post.canComment && post.text.trim().split(/\s+/).length >= 25 && !sellingPost(post.text);
}

/*
 * A job opening or an advert. A comment under either reads as applying for the
 * job or answering the ad, which is the wrong conversation to open under a
 * rep's name, so these are liked and never commented on. The first live week
 * commented "Is remote acceptable for the fractional, equity-only role?" under
 * a hiring post and asked whether a free food sample needed reheating.
 */
const SELLING_POST = [
  /\b(we'?re|we are|now|is) hiring\b|\bjob (opening|opportunity|posting)\b|\bopen (role|position)s?\b|\bjoin our team\b|\bapply (now|here|today|below)\b|\bon the hunt for an? \b|\blooking for an? [a-z ]{2,40}(leader|manager|director|engineer|rep|representative|candidate|hire)\b/i,
  /\b(free sample|promo code|use code|discount code|\d+% off|limited time|shop now|order now|buy now|sign up today|book your|subscription box)\b/i,
];

/** Whether a post is a job opening or an advert, which a comment never answers. */
export function sellingPost(text: string): boolean {
  const flat = text.replace(/\s+/g, " ");
  return SELLING_POST.some((pattern) => pattern.test(flat));
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
  problems.push(...commentPitchProblems(comment));
  return problems;
}
