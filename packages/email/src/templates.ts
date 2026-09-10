import type { EmailMessage } from "./provider.js";
import { escapeHtml, layout, list, paragraph } from "./render.js";

export interface InviteEmailInput {
  to: string;
  workspaceName: string;
  inviterName: string | null;
  role: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function inviteEmail(input: InviteEmailInput): EmailMessage {
  const inviter = input.inviterName ?? "A colleague";
  const lines = [
    `${inviter} has invited you to join ${input.workspaceName} on LinkedIn Employee as a ${input.role}.`,
    "You will connect your own LinkedIn account — nobody shares a login, and no two people on the team will ever message the same prospect.",
  ];

  return {
    to: input.to,
    subject: `${inviter} invited you to ${input.workspaceName}`,
    html: layout({
      title: `Join ${input.workspaceName}`,
      body: lines.map(paragraph).join(""),
      cta: { label: "Accept invitation", url: input.acceptUrl },
      footer: `This link expires in ${input.expiresInDays} days and works only for ${escapeHtml(
        input.to,
      )}. If you were not expecting it, you can ignore this email.`,
    }),
    text: [
      ...lines,
      "",
      `Accept: ${input.acceptUrl}`,
      "",
      `This link expires in ${input.expiresInDays} days and works only for ${input.to}.`,
    ].join("\n"),
  };
}

export interface DigestEmailInput {
  to: string;
  repName: string | null;
  appUrl: string;
  /** Counts for the period the digest covers. */
  invitesSent: number;
  accepted: number;
  replies: number;
  meetingsBooked: number;
  /** Drafts sitting in the inbox right now. */
  awaitingApproval: number;
  /** Upcoming meetings, soonest first, already formatted for a human. */
  upcoming: string[];
  /** Anything that needs the rep's attention, e.g. a paused account. */
  warnings: string[];
}

export function digestEmail(input: DigestEmailInput): EmailMessage {
  const greeting = input.repName ? `Morning, ${input.repName.split(" ")[0]}.` : "Morning.";

  // The subject line carries the number that decides whether this gets opened.
  const subject =
    input.awaitingApproval > 0
      ? `${input.awaitingApproval} ${input.awaitingApproval === 1 ? "reply needs" : "replies need"} you`
      : input.meetingsBooked > 0
        ? `${input.meetingsBooked} ${input.meetingsBooked === 1 ? "meeting" : "meetings"} booked yesterday`
        : "Your LinkedIn Employee digest";

  const stats = [
    `${input.invitesSent} ${input.invitesSent === 1 ? "invitation" : "invitations"} sent`,
    `${input.accepted} accepted`,
    `${input.replies} ${input.replies === 1 ? "reply" : "replies"}`,
    `${input.meetingsBooked} ${input.meetingsBooked === 1 ? "meeting" : "meetings"} booked`,
  ];

  const blocks = [
    paragraph(greeting),
    list(stats),
    input.awaitingApproval > 0
      ? paragraph(
          `${input.awaitingApproval} ${
            input.awaitingApproval === 1 ? "reply is" : "replies are"
          } waiting for your approval.`,
        )
      : "",
    input.upcoming.length ? `<p style="margin:0 0 8px;font-weight:600">Coming up</p>${list(input.upcoming)}` : "",
    input.warnings.length ? `<p style="margin:0 0 8px;font-weight:600">Needs attention</p>${list(input.warnings)}` : "",
  ]
    .filter(Boolean)
    .join("");

  const textLines = [
    greeting,
    "",
    ...stats.map((stat) => `- ${stat}`),
    ...(input.awaitingApproval > 0 ? ["", `${input.awaitingApproval} waiting for approval.`] : []),
    ...(input.upcoming.length ? ["", "Coming up:", ...input.upcoming.map((item) => `- ${item}`)] : []),
    ...(input.warnings.length ? ["", "Needs attention:", ...input.warnings.map((item) => `- ${item}`)] : []),
    "",
    `${input.appUrl}/app`,
  ];

  return {
    to: input.to,
    subject,
    html: layout({
      title: subject,
      body: blocks,
      cta: { label: "Open the inbox", url: `${input.appUrl}/app/inbox` },
      footer: "You are receiving this because you use LinkedIn Employee. Turn it off in your settings.",
    }),
    text: textLines.join("\n"),
  };
}

export interface AccountPausedInput {
  to: string;
  appUrl: string;
  status: string;
  detail: string | null;
}

/**
 * Sent the moment LinkedIn pushes back. This one matters more than the digest:
 * a paused account means outreach has stopped, and the rep would otherwise find
 * out days later by noticing nothing happened.
 */
export function accountPausedEmail(input: AccountPausedInput): EmailMessage {
  const lines = [
    `Your LinkedIn account is ${input.status.replace(/_/g, " ")}, so sending has stopped.`,
    input.detail ?? "",
    "Nothing has been lost — campaigns resume from where they paused once the account is healthy again.",
  ].filter(Boolean);

  return {
    to: input.to,
    subject: "Sending paused on your LinkedIn account",
    html: layout({
      title: "Sending is paused",
      body: lines.map(paragraph).join(""),
      cta: { label: "Reconnect your account", url: `${input.appUrl}/app/team` },
    }),
    text: [...lines, "", `${input.appUrl}/app/team`].join("\n"),
  };
}

/* ------------------------------------------------ onboarding and lifecycle */

export interface WelcomeInput {
  to: string;
  repName: string | null;
  appUrl: string;
  companyName: string;
}

/**
 * The first email. It arrives while the Strategy Agent is still working, so it
 * says what is happening rather than asking for anything — a first email that
 * opens with a task reads as a chore, and this one has genuinely useful news.
 */
export function welcomeEmail(input: WelcomeInput): EmailMessage {
  const first = input.repName?.split(" ")[0];
  const lines = [
    `${first ? `${first}, w` : "W"}elcome. The Strategy Agent is reading ${input.companyName}'s site right now and writing your business profile and three to five customer profiles from it.`,
    "That usually takes a minute or two. When it is done you will find them waiting for you to read — nothing gets searched for, and nobody gets contacted, until you have approved one.",
    "Two things worth knowing before you start. Your first campaign runs in approval mode, so every reply the agent writes waits for your click. And sending starts at ten invitations a day and takes five weeks to reach thirty-five, because the fastest way to lose a LinkedIn account is to arrive at volume on day one.",
  ];

  return {
    to: input.to,
    subject: "Your profiles are being written",
    html: layout({
      title: "Welcome — the agent is already working",
      body: lines.map(paragraph).join(""),
      cta: { label: "See what it has written", url: `${input.appUrl}/app/strategy` },
      footer: "Seven days free. No card until you decide.",
    }),
    text: [...lines, "", `${input.appUrl}/app/strategy`].join("\n"),
  };
}

export interface NudgeInput {
  to: string;
  repName: string | null;
  appUrl: string;
  /** The step they are stuck on, from ONBOARDING_STEPS. */
  step: { label: string; done: string; nudge: string; href: string };
  /** How many days their workspace has existed. */
  daysIn: number;
  /** Everything already done, so the email can say so rather than nag blindly. */
  completed: string[];
}

/**
 * Sent when a workspace stalls on one step.
 *
 * It names what is already done first. Someone who has connected LinkedIn and
 * approved a profile has not been idle, and an email that opens by telling them
 * what they have not done reads as an accusation from a robot with no memory.
 */
export function onboardingNudgeEmail(input: NudgeInput): EmailMessage {
  const first = input.repName?.split(" ")[0];
  const progress =
    input.completed.length > 0
      ? `You are further along than you might think — ${listInWords(input.completed)} ${input.completed.length === 1 ? "is" : "are"} done.`
      : "";

  const lines = [
    `${first ? `${first}, y` : "Y"}our workspace has been open ${input.daysIn === 1 ? "a day" : `${input.daysIn} days`} and there is one thing between you and a running campaign: ${input.step.done}.`,
    progress,
    input.step.nudge,
  ].filter(Boolean);

  return {
    to: input.to,
    subject: input.step.label,
    html: layout({
      title: input.step.label,
      body: lines.map(paragraph).join(""),
      cta: { label: "Pick up where you left off", url: `${input.appUrl}${input.step.href}` },
      footer: "One email per step, and only when something is genuinely waiting on you.",
    }),
    text: [...lines, "", `${input.appUrl}${input.step.href}`].join("\n"),
  };
}

export interface FirstMeetingInput {
  to: string;
  repName: string | null;
  appUrl: string;
  prospectName: string;
  prospectCompany: string | null;
  /**
   * Already formatted in the rep's own timezone by the calendar package. This
   * template never parses a datetime: the times a prospect sees and the time a
   * rep reads here come from the same formatter, so they cannot disagree.
   */
  when: string;
  /** The reply that turned into a meeting, so the email carries the evidence. */
  theirWords: string;
}

/**
 * The first booked meeting. Worth its own email, because it is the moment the
 * product either worked or did not, and nobody should have to find out by
 * opening a dashboard.
 */
export function firstMeetingEmail(input: FirstMeetingInput): EmailMessage {
  const who = input.prospectCompany
    ? `${input.prospectName} at ${input.prospectCompany}`
    : input.prospectName;
  const lines = [
    `Your first meeting is booked: ${who}, ${input.when}.`,
    `They wrote: “${input.theirWords}”`,
    "It is already in your calendar with the whole conversation attached, so you can open with what they actually said rather than a summary of it.",
  ];

  return {
    to: input.to,
    subject: `Meeting booked with ${input.prospectName}`,
    html: layout({
      title: "Your first meeting is booked",
      body: lines.map(paragraph).join(""),
      cta: { label: "See the conversation", url: `${input.appUrl}/app/meetings` },
    }),
    text: [...lines, "", `${input.appUrl}/app/meetings`].join("\n"),
  };
}

export interface TrialEndingInput {
  to: string;
  repName: string | null;
  appUrl: string;
  daysLeft: number;
  /** What actually happened, so the email argues with evidence not adjectives. */
  invited: number;
  accepted: number;
  meetings: number;
}

/**
 * Sent before a trial ends, and it leads with their own numbers rather than a
 * feature list. If those numbers are thin it says so — a trial email that
 * claims success against three invitations insults the reader.
 */
export function trialEndingEmail(input: TrialEndingInput): EmailMessage {
  const first = input.repName?.split(" ")[0];
  const thin = input.invited < 20;

  const summary = thin
    ? `So far: ${input.invited} invitations out, ${input.accepted} accepted, ${input.meetings} ${input.meetings === 1 ? "meeting" : "meetings"} booked. That is early — the warm-up means the first fortnight is deliberately slow, so this is not yet a fair test of anything.`
    : `Your numbers so far: ${input.invited} invitations out, ${input.accepted} accepted, ${input.meetings} ${input.meetings === 1 ? "meeting" : "meetings"} booked.`;

  const lines = [
    `${first ? `${first}, y` : "Y"}our trial ends in ${input.daysLeft === 1 ? "a day" : `${input.daysLeft} days`}.`,
    summary,
    "When it ends, sending stops and everything else stays exactly where it is — your prospects, your conversations and any booked meetings are still there whenever you come back.",
  ];

  return {
    to: input.to,
    subject: input.daysLeft === 1 ? "Your trial ends tomorrow" : `Your trial ends in ${input.daysLeft} days`,
    html: layout({
      title: "Your trial is nearly up",
      body: lines.map(paragraph).join(""),
      cta: { label: "Choose a plan", url: `${input.appUrl}/app/billing` },
      footer: "Nothing is deleted if you do not. Sending simply pauses.",
    }),
    text: [...lines, "", `${input.appUrl}/app/billing`].join("\n"),
  };
}

/** "a, b and c" — an Oxford-comma-free list, because this is prose not data. */
function listInWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
