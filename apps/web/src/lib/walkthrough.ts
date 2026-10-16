/**
 * The tour of the app, one screen at a time (rule 65).
 *
 * Onboarding ends with a live campaign and somebody who has seen eight setup
 * screens and none of the product. Left there, they open twelve links of equal
 * weight with no idea which ones they will use — the question the founder kept
 * being asked was "what am I supposed to do in here". So the app opens on a
 * short tour: each stop is the real page, with two sentences on what it is for
 * and when to come back to it. "How it works" can start it again.
 *
 * Ten stops, in the order somebody will need them, and no more: a tour longer
 * than this is skipped, and a skipped tour taught nothing.
 */
export interface WalkthroughStop {
  href: string;
  title: string;
  body: string;
}

export const WALKTHROUGH: readonly WalkthroughStop[] = [
  {
    href: "/app",
    title: "Overview",
    body: "Start here each day. What needs you is at the top, then today's invitations against your daily limits and how your campaigns are doing.",
  },
  {
    href: "/app/campaigns",
    title: "Campaigns",
    body: "Every campaign, live or draft. Open one to see who goes next and when, add more people with Find more, or pause it.",
  },
  {
    href: "/app/inbox",
    title: "Inbox",
    body: "Replies land here. Anything held for you waits with a draft ready to send. On autopilot the agent answers clear replies itself.",
  },
  {
    href: "/app/prospects",
    title: "Prospects",
    body: "Everyone Nora has found and everyone it has contacted, by strategy, with why each person fits.",
  },
  {
    href: "/app/strategy",
    title: "Strategies",
    body: "Who to go after. Approving another strategy builds another campaign. Ask Sage for more when you want new markets.",
  },
  {
    href: "/app/agents",
    title: "Agents",
    body: "How the agent writes and behaves: its brand, the documents it may quote, and a test reply you can try before a real person reads one.",
  },
  {
    href: "/app/pitch",
    title: "Opener and pitch",
    body: "The opening line and the offer, approved one line at a time. Nothing that has not been approved is ever sent.",
  },
  {
    href: "/app/cta",
    title: "Calls to action",
    body: "Where campaigns send people: a call, a link or a conversation. Fix a link here once and every campaign using it changes.",
  },
  {
    href: "/app/exclusions",
    title: "Do not contact",
    body: "Customers, competitors and anyone who must never hear from you. It is checked right before every single send.",
  },
  {
    href: "/app/profile",
    title: "Profile and team",
    body: "Your LinkedIn plan, sending hours, voice and scheduling link, and the teammates in your workspace. Help is under Support.",
  },
];

/** The stop for a `?tour=` value, or null when it is not one. */
export function walkthroughStop(raw: string | null | undefined): { index: number; stop: WalkthroughStop } | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > WALKTHROUGH.length) return null;
  return { index: n - 1, stop: WALKTHROUGH[n - 1]! };
}

/** Where a tour button goes: the stop's own page, carrying its number. */
export function walkthroughHref(index: number): string {
  const stop = WALKTHROUGH[index];
  return stop ? `${stop.href}?tour=${index + 1}` : "/app";
}
