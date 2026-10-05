import { BRAND, LINKEDIN_LIMITS } from "@le/shared";
import type { EmailMessage } from "./provider.js";
import { callout, escapeHtml, facts, layout, list, note, paragraph, prose, signoff, steps, subheading } from "./render.js";
import { listInWords, TEAM } from "./templates.js";
import { unsubscribeHeaders } from "./unsubscribe.js";

/**
 * The onboarding sequence, the operator's notifications and announcements.
 *
 * The sequence is keyed to what somebody has actually done, not to the
 * calendar: the worker reads their real state and skips any step they have
 * already finished, so nobody is told to connect an account that is connected.
 * Each of these is marketing in the legal sense — it is about using the
 * product, not about something that happened to their account — so each one
 * carries a one-click unsubscribe, both as a link and as the RFC 8058 headers.
 * A marketing email cannot be built without an unsubscribe URL: the field is
 * required, so the type system refuses the version that has no way out.
 */

export interface MarketingInput {
  to: string;
  repName: string | null;
  appUrl: string;
  /** Required. A marketing email with no way out is not one this product sends. */
  unsubscribeUrl: string;
  postalAddress?: string | null;
}

function firstName(name: string | null | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

function greet(input: MarketingInput, fallback = "Hi"): string {
  const first = firstName(input.repName);
  return first ? `Hi ${first},` : `${fallback},`;
}

const SEQUENCE_FOOTER = `You are receiving this because you signed up for ${escapeHtml(
  BRAND.name,
)}. These setup tips stop on their own once you are up and running.`;

function marketing(
  input: MarketingInput,
  parts: {
    subject: string;
    title: string;
    preheader: string;
    body: string;
    cta: { label: string; path: string };
    after?: string;
    text: string[];
    footer?: string;
  },
): EmailMessage {
  const url = `${input.appUrl}${parts.cta.path}`;
  return {
    to: input.to,
    subject: parts.subject,
    headers: unsubscribeHeaders(input.unsubscribeUrl),
    html: layout({
      title: parts.title,
      preheader: parts.preheader,
      appUrl: input.appUrl,
      body: parts.body,
      cta: { label: parts.cta.label, url },
      after: parts.after ?? signoff(),
      footer: parts.footer ?? SEQUENCE_FOOTER,
      unsubscribeUrl: input.unsubscribeUrl,
      postalAddress: input.postalAddress,
    }),
    text: [
      ...parts.text,
      "",
      `${parts.cta.label}: ${url}`,
      "",
      `— ${BRAND.name}`,
      "",
      `Unsubscribe from product emails: ${input.unsubscribeUrl}`,
      ...(input.postalAddress ? [input.postalAddress] : []),
    ].join("\n"),
  };
}

/* --------------------------------------------------------- the sequence */

/** About an hour in, with no workspace: the one input everything waits on. */
export function finishSetupEmail(input: MarketingInput): EmailMessage {
  const lines = [
    "You created your account but haven't told me about your business yet — and that's the one thing everything else waits on.",
    "Sage writes your customer strategies from it, and until there's a strategy Scout has nobody to look for.",
    "Paste your website, or write a couple of sentences if you'd rather. Sage does the writing, and you'll have strategies to read in a minute or two.",
  ];
  return marketing(input, {
    subject: "Three minutes and your team can start",
    title: "One thing left before Sage can start",
    preheader: "Tell me about your business and Sage writes your first strategies.",
    body: [paragraph(greet(input)), ...lines.map(paragraph)].join(""),
    cta: { label: "Finish setting up", path: "/onboarding" },
    text: [greet(input), "", ...lines],
  });
}

/** Day one, LinkedIn not connected: how the hosted sign-in works. */
export function connectLinkedInEmail(input: MarketingInput): EmailMessage {
  const intro = [
    "Everything Reese sends goes out from your own LinkedIn account, under your name. Until it's connected, campaigns can be written and reviewed, but nothing can leave.",
  ];
  const how = [
    {
      title: "Open your profile and press Connect LinkedIn",
      detail: "It takes about a minute.",
    },
    {
      title: "Sign in on the secure hosted page",
      detail: "Your password goes straight to the sign-in page. We never see it and never store it.",
    },
    {
      title: "Approve the check if LinkedIn asks",
      detail: "A code by email or a tap in the LinkedIn app is normal — it's LinkedIn confirming it's you.",
    },
  ];
  const tipTitle = "Do you sign in to LinkedIn with Google or Apple?";
  const tip =
    "Then your LinkedIn account may not have a password of its own yet, and the hosted sign-in needs one. Set one first in LinkedIn under Settings → Sign in & security → Change password (or use “Forgot password” on LinkedIn's sign-in page). Google or Apple sign-in keeps working as before.";

  return marketing(input, {
    subject: "Connect LinkedIn so Reese can start sending",
    title: "Connect your LinkedIn account",
    preheader: "A minute on a secure sign-in page. We never see your password.",
    body: [
      paragraph(greet(input)),
      ...intro.map(paragraph),
      subheading("How it works"),
      steps(how),
      callout(tipTitle, tip),
    ].join(""),
    cta: { label: "Connect LinkedIn", path: "/app/profile" },
    text: [
      greet(input),
      "",
      ...intro,
      "",
      "How it works:",
      ...how.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`),
      "",
      `${tipTitle} ${tip}`,
    ],
  });
}

/** Day two, nothing approved: the strategies are written and waiting. */
export function approveStrategiesEmail(
  input: MarketingInput & { companyName: string | null; strategies: number },
): EmailMessage {
  const count =
    input.strategies === 1 ? "one customer strategy" : `${input.strategies} customer strategies`;
  const lines = [
    `Sage has written ${count}${input.companyName ? ` for ${input.companyName}` : ""}: who to talk to, what they're struggling with, and why they'd buy from you.`,
    "Nothing is searched for until you approve one. That's deliberate — Scout only looks for people on a strategy you've read and agreed with.",
    "Read them the way you'd read a brief from a new hire. Approve the ones that sound right, edit what doesn't, and skip the rest.",
  ];
  return marketing(input, {
    subject: input.strategies === 1 ? "Your strategy is ready to review" : "Your strategies are ready to review",
    title: "Your strategies are waiting for a yes",
    preheader: `Sage wrote ${count}. Scout starts the moment you approve one.`,
    body: [paragraph(greet(input)), ...lines.map(paragraph)].join(""),
    cta: { label: "Review strategies", path: "/app/strategy" },
    text: [greet(input), "", ...lines],
  });
}

/** Day three, nothing launched. Two versions: built and waiting, or not built yet. */
export function launchCampaignEmail(input: MarketingInput & { hasCampaign: boolean }): EmailMessage {
  const start = LINKEDIN_LIMITS.invitesPerDayStart;
  const lines = input.hasCampaign
    ? [
        "Your first campaign is built and sitting in draft. Scout found people who fit your approved strategy, and Quinn wrote each of them a note from their own profile.",
        "Read it the way you'd read anything going out under your name: remove anyone you wouldn't message yourself, adjust the wording, then launch.",
        `Reese starts gently — ${start} invitations on the first day, spread across your working hours — so your account looks like a person, not a tool.`,
      ]
    : [
        "Your strategy is approved and your LinkedIn account is connected, so everything is in place for a first campaign.",
        "Open your strategy and Scout will build the list: real people who fit it, each with a personal note from Quinn, waiting for you to read before anything sends.",
        `When you launch, Reese starts gently — ${start} invitations on the first day, spread across your working hours.`,
      ];
  return marketing(input, {
    subject: input.hasCampaign ? "Your first campaign is ready to read" : "Ready for your first campaign",
    title: input.hasCampaign ? "Review it, then launch" : "Start your first campaign",
    preheader: input.hasCampaign
      ? "Read every name and every note, then press launch."
      : "Scout builds the list from your approved strategy.",
    body: [paragraph(greet(input)), ...lines.map(paragraph)].join(""),
    cta: input.hasCampaign
      ? { label: "Review and launch", path: "/app/campaigns" }
      : { label: "Build my first campaign", path: "/app/strategy" },
    text: [greet(input), "", ...lines],
  });
}

/** Day five: Sales Navigator versus regular, and how pacing protects the account. */
export function tipsEmail(input: MarketingInput): EmailMessage {
  const L = LINKEDIN_LIMITS;
  const weeks = Math.round(L.warmupDays / 7);
  const navigator = [
    "Both work. With Sales Navigator, Scout can filter by seniority, company size and job titles you want left out, so lists come back tighter.",
    "Regular LinkedIn search can't express those filters, so lists are broader and you'll trim more of them yourself. Whichever you have, make sure your profile says so — a search sent to a kind of account you don't have comes back empty.",
  ];
  const pacing = [
    `A daily cap that is a rule, not a setting: ${L.invitesPerDayStart} invitations a day at first, rising to ${L.invitesPerDayMax} over about ${weeks} weeks from your first send.`,
    "Each day's invitations are spread across your working hours, minutes apart — never fired off in a burst.",
    "A quick look at someone's profile before the invitation, so your name is familiar when it arrives.",
    `A hard ceiling of ${L.invitesPerWeek} invitations a week across every campaign combined, so no week ever looks like a burst.`,
  ];
  const after = "If LinkedIn ever pushes back, Reese pauses on its own and I'll email you straight away.";
  return marketing(input, {
    subject: `How ${BRAND.name} keeps your LinkedIn account safe`,
    title: "Two things worth knowing",
    preheader: "Sales Navigator or regular LinkedIn, and why Reese sends slowly on purpose.",
    body: [
      paragraph(greet(input)),
      paragraph("A few days in, two questions come up more than any others. Here are the short answers."),
      subheading("Sales Navigator or regular LinkedIn?"),
      ...navigator.map(paragraph),
      subheading("Why Reese sends slowly on purpose"),
      paragraph(
        "The fastest way to lose a LinkedIn account is to arrive at volume on day one. So the pace is built in:",
      ),
      list(pacing),
      note(after),
    ].join(""),
    cta: { label: "See today's allowance", path: "/app" },
    text: [
      greet(input),
      "",
      "Sales Navigator or regular LinkedIn?",
      ...navigator,
      "",
      "Why Reese sends slowly on purpose:",
      ...pacing.map((p) => `- ${p}`),
      "",
      after,
    ],
  });
}

/** Day seven: a real question, and a reply that reaches a person. */
export function checkInEmail(input: MarketingInput & { done: string[] }): EmailMessage {
  const progress = input.done.length
    ? `So far: ${listInWords(input.done)}. That's real progress.`
    : "You haven't got far into setup yet, which usually means something got in the way — and that's exactly what I'd like to hear about.";
  const lines = [
    "You've been with us a week, and I'd genuinely like to know how it's going.",
    progress,
    "Is something confusing, missing, or not working the way you expected? Just reply to this email. A person on our team reads every reply and will get back to you.",
  ];
  return marketing(input, {
    subject: "One week in — how's it going?",
    title: "How's it going?",
    preheader: "Reply to this email — a person on our team reads every one.",
    body: [paragraph(greet(input)), ...lines.map(paragraph)].join(""),
    cta: { label: "Open your dashboard", path: "/app" },
    text: [greet(input), "", ...lines],
  });
}

/* ------------------------------------------------- operator notifications */

export type AdminEvent = "signup" | "onboarded" | "linkedin_connected";

export interface AdminNotifyInput {
  to: string;
  appUrl: string;
  event: AdminEvent;
  name: string | null;
  email: string;
  company: string | null;
  /** When it happened. */
  at: Date;
  /** The workspace to open in the console, when there is one yet. */
  workspaceId: string | null;
}

const ADMIN_COPY: Record<AdminEvent, { verb: string; title: string }> = {
  signup: { verb: "signed up", title: "New signup" },
  onboarded: { verb: "finished onboarding", title: "Onboarding finished" },
  linkedin_connected: { verb: "connected LinkedIn", title: "LinkedIn connected" },
};

/** "5 Oct 2026, 15:42 UTC" — one zone for every operator, said out loud. */
export function formatUtc(at: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(at)} UTC`;
}

/**
 * Sent to every platform admin. Transactional: it is about this deployment's
 * own operation, it carries no unsubscribe, and it goes only to people who are
 * in `platform_admins` or named in `ADMIN_NOTIFY_EMAILS`.
 */
export function adminNotifyEmail(input: AdminNotifyInput): EmailMessage {
  const copy = ADMIN_COPY[input.event];
  const who = input.name?.trim() || input.email;
  const consoleUrl = input.workspaceId
    ? `${input.appUrl}/admin/workspaces/${input.workspaceId}`
    : `${input.appUrl}/admin`;
  const rows = [
    { label: "Name", value: input.name?.trim() || "Not given" },
    { label: "Email", value: input.email },
    { label: "Company", value: input.company ?? "Not yet — asked at onboarding" },
    { label: "When", value: formatUtc(input.at) },
  ];
  return {
    to: input.to,
    subject: `${copy.title}: ${who}${input.company ? ` (${input.company})` : ""}`,
    html: layout({
      title: `${who} ${copy.verb}`,
      preheader: `${input.email}${input.company ? ` · ${input.company}` : ""} · ${formatUtc(input.at)}`,
      appUrl: input.appUrl,
      body: facts(rows),
      cta: { label: input.workspaceId ? "Open workspace in console" : "Open the console", url: consoleUrl },
      footer: `You are receiving this because you are a platform admin on ${escapeHtml(BRAND.full)}.`,
    }),
    text: [`${who} ${copy.verb}.`, "", ...rows.map((r) => `${r.label}: ${r.value}`), "", consoleUrl].join("\n"),
  };
}

/* ------------------------------------------------------- announcements */

export interface AnnouncementInput {
  to: string;
  appUrl: string;
  subject: string;
  /** Plain text. Blank lines separate paragraphs; nothing is read as HTML. */
  body: string;
  cta?: { label: string; url: string } | null;
  unsubscribeUrl: string;
  postalAddress?: string | null;
}

export function announcementEmail(input: AnnouncementInput): EmailMessage {
  const paragraphs = input.body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    to: input.to,
    subject: input.subject,
    headers: unsubscribeHeaders(input.unsubscribeUrl),
    html: layout({
      title: input.subject,
      preheader: paragraphs[0]?.slice(0, 140),
      appUrl: input.appUrl,
      body: prose(input.body),
      cta: input.cta ?? undefined,
      after: signoff(`${BRAND.name} and the team`),
      footer: `You are receiving this product update because you have a ${escapeHtml(BRAND.name)} account.`,
      unsubscribeUrl: input.unsubscribeUrl,
      postalAddress: input.postalAddress,
    }),
    text: [
      ...paragraphs.flatMap((p) => [p, ""]),
      ...(input.cta ? [`${input.cta.label}: ${input.cta.url}`, ""] : []),
      `— ${BRAND.name} and the team`,
      "",
      `Unsubscribe from product emails: ${input.unsubscribeUrl}`,
      ...(input.postalAddress ? [input.postalAddress] : []),
    ].join("\n"),
  };
}
