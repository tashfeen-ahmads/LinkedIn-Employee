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
