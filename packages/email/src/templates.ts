import { BRAND } from "@le/shared";
import type { EmailMessage } from "./provider.js";
import { escapeHtml, layout, list, note, paragraph, roster, signoff, stats, subheading } from "./render.js";

/** The origin of an absolute URL, for templates that are handed a link but not the app's address. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function firstName(name: string | null | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

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
    `${inviter} has invited you to join ${input.workspaceName} on ${BRAND.name} as a ${input.role}.`,
    "You will connect your own LinkedIn account — nobody shares a login, and no two people on the team will ever message the same prospect.",
  ];

  return {
    to: input.to,
    subject: `${inviter} invited you to ${input.workspaceName}`,
    html: layout({
      title: `Join ${input.workspaceName}`,
      preheader: `${inviter} added you to the team on ${BRAND.name}.`,
      appUrl: originOf(input.acceptUrl),
      body: lines.map(paragraph).join(""),
      cta: { label: "Accept invitation", url: input.acceptUrl },
      after: note(
        `This link expires in ${input.expiresInDays} days and works only for ${input.to}. If you were not expecting it, you can ignore this email.`,
      ),
      footer: `You are receiving this because ${escapeHtml(inviter)} invited ${escapeHtml(input.to)} to a ${escapeHtml(
        BRAND.name,
      )} workspace.`,
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
  const first = firstName(input.repName);
  const greeting = first ? `Morning, ${first}.` : "Morning.";

  // The subject line carries the number that decides whether this gets opened.
  const subject =
    input.awaitingApproval > 0
      ? `${input.awaitingApproval} ${input.awaitingApproval === 1 ? "reply needs" : "replies need"} you`
      : input.meetingsBooked > 0
        ? `${input.meetingsBooked} ${input.meetingsBooked === 1 ? "meeting" : "meetings"} booked yesterday`
        : `Your ${BRAND.name} digest`;

  const stats4 = [
    `${input.invitesSent} ${input.invitesSent === 1 ? "invitation" : "invitations"} sent`,
    `${input.accepted} accepted`,
    `${input.replies} ${input.replies === 1 ? "reply" : "replies"}`,
    `${input.meetingsBooked} ${input.meetingsBooked === 1 ? "meeting" : "meetings"} booked`,
  ];

  const blocks = [
    paragraph(greeting),
    stats([
      { value: input.invitesSent, label: input.invitesSent === 1 ? "invitation sent" : "invitations sent" },
      { value: input.accepted, label: "accepted" },
      { value: input.replies, label: input.replies === 1 ? "reply" : "replies" },
      { value: input.meetingsBooked, label: input.meetingsBooked === 1 ? "meeting booked" : "meetings booked" },
    ]),
    input.awaitingApproval > 0
      ? paragraph(
          `${input.awaitingApproval} ${
            input.awaitingApproval === 1 ? "reply is" : "replies are"
          } waiting for your approval.`,
        )
      : "",
    input.upcoming.length ? `${subheading("Coming up")}${list(input.upcoming)}` : "",
    input.warnings.length ? `${subheading("Needs attention")}${list(input.warnings)}` : "",
  ]
    .filter(Boolean)
    .join("");

  const textLines = [
    greeting,
    "",
    ...stats4.map((stat) => `- ${stat}`),
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
      preheader: `${stats4.join(" · ")}.`,
      appUrl: input.appUrl,
      body: blocks,
      cta: { label: "Open the inbox", url: `${input.appUrl}/app/inbox` },
      footer: `You are receiving this because you use ${escapeHtml(BRAND.name)}. Turn it off in your settings.`,
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
      preheader: "Campaigns pick up where they stopped once the account is healthy.",
      appUrl: input.appUrl,
      body: lines.map(paragraph).join(""),
      cta: { label: "Reconnect your account", url: `${input.appUrl}/app/team` },
    }),
    text: [...lines, "", `${input.appUrl}/app/team`].join("\n"),
  };
}

/* ------------------------------------------------ onboarding and lifecycle */

/**
 * The four AI employees, in the words every email uses for them.
 *
 * One list so the welcome and every later email describe the same team the
 * same way — a strategist in one email and a "researcher" in the next is a
 * product that does not know its own staff.
 */
export const TEAM = [
  {
    name: "Sage",
    role: "Strategist",
    detail: "Reads your business and writes the customer strategies worth pursuing.",
  },
  {
    name: "Scout",
    role: "Prospector",
    detail: "Finds real people on LinkedIn who fit a strategy you have approved.",
  },
  {
    name: "Quinn",
    role: "Campaign writer",
    detail: "Writes each of them a personal note, from their own profile.",
  },
  {
    name: "Reese",
    role: "Outreach & booking",
    detail: "Sends on your behalf at a safe pace, answers replies and books the meetings.",
  },
] as const;

export interface WelcomeInput {
  to: string;
  repName: string | null;
  appUrl: string;
}

/**
 * The first email, sent the moment somebody signs up.
 *
 * It introduces the team and asks for exactly one thing — the business —
 * because that is the one input every other step waits on. It makes no promise
 * about money or a trial: the product is free while it is being built, and an
 * email that mentions a price is the one people forward with a question mark.
 */
export function welcomeEmail(input: WelcomeInput): EmailMessage {
  const first = firstName(input.repName);
  const opening =
    "I'm your AI executive assistant, and from today I lead a small team with one job: booking you meetings from LinkedIn, without putting your account at risk.";
  const approval =
    "Nothing goes out without you. You approve every strategy, and you read every campaign before it launches.";
  const ask =
    "To get started, tell me about your business. Paste your website or write a couple of sentences, and Sage will have strategies for you to read in a minute or two.";

  return {
    to: input.to,
    subject: `Welcome to ${BRAND.name} — meet your team`,
    html: layout({
      title: first ? `Welcome, ${first}. I'm ${BRAND.name}.` : `Welcome. I'm ${BRAND.name}.`,
      preheader: "Four AI employees, one job: meetings from LinkedIn. Nothing sends without your approval.",
      appUrl: input.appUrl,
      body: [
        paragraph(opening),
        subheading("Your team"),
        roster([...TEAM]),
        paragraph(approval),
        paragraph(ask),
      ].join(""),
      cta: { label: "Tell me about your business", url: `${input.appUrl}/onboarding` },
      after: `${note("It takes about three minutes. Questions? Reply to this email — a person on our team reads every reply.")}${signoff()}`,
      footer: `You are receiving this because you just created a ${escapeHtml(BRAND.name)} account with this address.`,
    }),
    text: [
      first ? `Welcome, ${first}.` : "Welcome.",
      "",
      opening,
      "",
      "Your team:",
      ...TEAM.map((p) => `- ${p.name} (${p.role}): ${p.detail}`),
      "",
      approval,
      "",
      ask,
      "",
      `${input.appUrl}/onboarding`,
      "",
      "Questions? Reply to this email — a person on our team reads every reply.",
      "",
      `— ${BRAND.name}`,
    ].join("\n"),
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
      preheader: `${who}, ${input.when}.`,
      appUrl: input.appUrl,
      body: lines.map(paragraph).join(""),
      cta: { label: "See the conversation", url: `${input.appUrl}/app/meetings` },
      after: signoff(),
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
 *
 * Only ever sent while `TRIAL_LIMIT_ENFORCED` is on, which it is not while the
 * product is free; `lifecycle.ts` checks before it gets here.
 */
export function trialEndingEmail(input: TrialEndingInput): EmailMessage {
  const first = firstName(input.repName);
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
      appUrl: input.appUrl,
      body: lines.map(paragraph).join(""),
      cta: { label: "Choose a plan", url: `${input.appUrl}/app/billing` },
      after: note("Nothing is deleted if you do not. Sending simply pauses."),
    }),
    text: [...lines, "", `${input.appUrl}/app/billing`].join("\n"),
  };
}

/** "a, b and c" — an Oxford-comma-free list, because this is prose not data. */
export function listInWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The week, in the same words the overview uses.
 *
 * This is the email a rep forwards to whoever signs off the subscription, so
 * it has one job: say what the agent did in sentences a person who has never
 * opened the product can read. The daily digest is a working tool — counters
 * and the number waiting — and it is the wrong thing to forward.
 *
 * `lines` arrives already assembled by `dailyReport` in @le/shared, deliberately.
 * The words are the part that must not drift: the screen reads that function
 * today and this reads it weekly, and if the email wrote its own prose the two
 * would describe the same week differently, with the rep believing whichever
 * they happened to open. `knowledge` is the other half — what has accumulated
 * that could not be handed to a new tool on day one — and it is the sentence
 * that answers "why are we still paying for this".
 */
export interface WeeklyReportInput {
  to: string;
  repName?: string | null;
  appUrl: string;
  /** From `dailyReport`, over a seven-day window. */
  lines: string[];
  /** From `knowledgeSentences`. Omitted when the workspace has accumulated nothing. */
  knowledge: string[];
  /** For the subject line: the week's invitations and acceptances. */
  invited: number;
  accepted: number;
}

export function weeklyReportEmail(input: WeeklyReportInput): EmailMessage {
  const greeting = input.repName ? `${input.repName.split(" ")[0]}, here is your week.` : "Here is your week.";

  /*
   * The subject carries the outcome, never the activity.
   *
   * "12 invitations sent" is a sentence about effort and it is what every tool
   * in this category puts in a subject line. Acceptances are the first thing
   * that happened *to* somebody, so they are the first thing worth opening for.
   */
  const subject =
    input.accepted > 0
      ? `${input.accepted} ${input.accepted === 1 ? "person" : "people"} accepted this week`
      : input.invited > 0
        ? `Your week: ${input.invited} ${input.invited === 1 ? "invitation" : "invitations"}`
        : `Your week on ${BRAND.name}`;

  const blocks = [
    paragraph(greeting),
    ...input.lines.map((line) => paragraph(line)),
    input.knowledge.length
      ? `${subheading("What your agent knows")}${input.knowledge
          .map((line) => paragraph(line))
          .join("")}`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const textLines = [
    greeting,
    "",
    ...input.lines,
    ...(input.knowledge.length ? ["", "What your agent knows:", ...input.knowledge] : []),
    "",
    `${input.appUrl}/app`,
  ];

  return {
    to: input.to,
    subject,
    html: layout({
      title: subject,
      preheader: input.lines[0],
      appUrl: input.appUrl,
      body: blocks,
      cta: { label: "Open your dashboard", url: `${input.appUrl}/app` },
      footer: `You are receiving this because you use ${escapeHtml(BRAND.name)}. Turn it off in your settings.`,
    }),
    text: textLines.join("\n"),
  };
}

export interface RecoveryAccount {
  email: string;
  /** The workspace this sign-in opens, or null for one that never finished setting up. */
  workspace: string | null;
}

export interface PasswordResetInput {
  to: string;
  appUrl: string;
  name: string | null;
  /** One link per account found for this address, each signing in as that account. */
  links: Array<RecoveryAccount & { url: string }>;
}

/**
 * A link to choose a new password.
 *
 * Several links when the address has several accounts behind it — the Proton
 * aliases are one inbox and can be three sign-ins, and the one with the
 * workspace is the one the person is looking for, so it is named as such.
 */
export function passwordResetEmail(input: PasswordResetInput): EmailMessage {
  const first = firstName(input.name);
  const many = input.links.length > 1;
  const describe = (a: RecoveryAccount) =>
    a.workspace ? `${a.email} — your ${a.workspace} workspace` : `${a.email} — not set up yet`;
  const ordered = [...input.links].sort((a, b) => Number(Boolean(b.workspace)) - Number(Boolean(a.workspace)));
  const primary = ordered[0]!;
  const lines = [
    first ? `Hi ${first},` : "Hi,",
    many
      ? "This address has more than one sign-in. Each link below sets a new password for that one; the one with your workspace is first."
      : "Somebody asked to reset the password for this address. If it was you, choose a new one with the button below.",
  ];
  return {
    to: input.to,
    subject: `Reset your ${BRAND.name} password`,
    html: layout({
      title: "Choose a new password",
      preheader: `A link to reset your ${BRAND.name} password. It works once and expires in an hour.`,
      appUrl: input.appUrl,
      body: [
        ...lines.map(paragraph),
        many
          ? ordered
              .map(
                (l) =>
                  `<p style="margin:0 0 12px;font-size:16px;line-height:24px;"><a href="${escapeHtml(l.url)}">${escapeHtml(describe(l))}</a></p>`,
              )
              .join("")
          : "",
      ].join(""),
      cta: { label: many ? `Reset ${primary.email}` : "Choose a new password", url: primary.url },
      after: note(
        "Each link works once and expires in an hour. If you did not ask for this, ignore it — your password has not changed.",
      ),
      footer: `You are receiving this because a password reset was requested for ${escapeHtml(input.to)} on ${escapeHtml(
        BRAND.name,
      )}.`,
    }),
    text: [
      ...lines,
      "",
      ...ordered.map((l) => `${describe(l)}:\n${l.url}`),
      "",
      "Each link works once and expires in an hour. If you did not ask for this, ignore it.",
    ].join("\n"),
  };
}

export interface SignInReminderInput {
  to: string;
  appUrl: string;
  name: string | null;
  accounts: Array<RecoveryAccount & { username: string | null }>;
}

/** Which address — and username, if any — signs in to which workspace. */
export function signInReminderEmail(input: SignInReminderInput): EmailMessage {
  const first = firstName(input.name);
  const ordered = [...input.accounts].sort((a, b) => Number(Boolean(b.workspace)) - Number(Boolean(a.workspace)));
  const rows = ordered.map(
    (a) =>
      `${a.email}${a.username ? ` (username ${a.username})` : ""} — ${
        a.workspace ? `signs in to ${a.workspace}` : "not set up yet"
      }`,
  );
  const lines = [
    first ? `Hi ${first},` : "Hi,",
    ordered.length > 1
      ? "You have more than one sign-in. Use the one with your workspace — signing in with another starts a new, empty setup."
      : "Here is how you sign in:",
  ];
  return {
    to: input.to,
    subject: `How you sign in to ${BRAND.name}`,
    html: layout({
      title: "Your sign-in",
      preheader: "The email address that opens your workspace.",
      appUrl: input.appUrl,
      body: [...lines.map(paragraph), list(rows)].join(""),
      cta: { label: "Sign in", url: `${input.appUrl}/login` },
      after: note(`Forgot the password too? Use "Forgot password" on the sign-in page.`),
      footer: `You are receiving this because somebody asked which sign-in belongs to ${escapeHtml(input.to)} on ${escapeHtml(
        BRAND.name,
      )}.`,
    }),
    text: [...lines, "", ...rows.map((r) => `- ${r}`), "", `Sign in: ${input.appUrl}/login`].join("\n"),
  };
}
