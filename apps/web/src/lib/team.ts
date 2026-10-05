import { BRAND } from "@le/shared";

/**
 * NORA and the four people she runs, defined once.
 *
 * The names are a way of talking about jobs the product already does — they
 * are not new agents and they invent no capability. Each one maps onto code
 * that exists, and the bullets say only what that code does:
 *
 *  - Sage  → the Strategy Agent (`packages/agents/src/strategy.ts`), which
 *            writes the business profile and the customer strategies and
 *            never approves them (rule 9).
 *  - Scout → the search half of targeting (`resolveFilters`, the tier check,
 *            `verifyProfiles`, the exclusion list, never-twice — rules 12, 13,
 *            14, 24).
 *  - Quinn → the writing half (`personalizeInvites`, the campaign builder,
 *            angles — rules 16, 28).
 *  - Reese → the sending path and the Reply Agent (`linkedin-action.ts`, the
 *            pacing loop, the reply gate, booking — rules 1, 6, 41, 48).
 *  - NORA  → the product itself: the one list of what needs you, the hand-off
 *            from one job to the next, and the repairs nobody has to ask for
 *            (rules 8, 42, 50).
 *
 * The marketing page and the dashboard both read this, so the site cannot
 * promise a teammate the product does not have — the same reason the
 * marketing caps are read from the constants the limiter obeys.
 */

/** The brand's name as the assistant is introduced: one definition, from BRAND. */
export const NORA = BRAND.name.toUpperCase();

export type MemberKey = "sage" | "scout" | "quinn" | "reese";

export interface TeamMember {
  key: MemberKey;
  name: string;
  role: string;
  /** One line: what they are for. */
  line: string;
  /** What they actually do, two or three of them, each true of the code. */
  does: readonly string[];
  /** Where their work shows up in the dashboard. */
  href: string;
}

export const LEAD = {
  name: NORA,
  role: "AI executive assistant",
  line: "Runs your dashboard and leads the team, so you only hear about what needs you.",
  does: [
    "Passes each job to the next teammate, and stops at the three decisions that are yours.",
    "Keeps one list of what needs you, and says what happens if nobody does it.",
    "Watches the account and the sending, and restarts a stuck queue without being asked.",
  ],
  href: "/app",
} as const;

/** In hand-off order: each one's output is the next one's input. */
export const TEAM: readonly TeamMember[] = [
  {
    key: "sage",
    name: "Sage",
    role: "Strategist",
    line: "Reads your business and writes who to target, and why.",
    does: [
      "Reads your website and LinkedIn page and writes your business profile.",
      "Drafts three to five customer strategies — pains, buying signals, search filters — and more when you ask.",
      "Never approves its own work: nothing is searched for until you approve a strategy.",
    ],
    href: "/app/strategy",
  },
  {
    key: "scout",
    name: "Scout",
    role: "Prospector",
    line: "Finds real people on LinkedIn who match a strategy you approved.",
    does: [
      "Searches on the LinkedIn tier you actually have, and tells you which filters it could not apply.",
      "Opens every profile first — anyone who cannot be checked is left out, and counted.",
      "Skips your exclusion list and never contacts anyone twice.",
    ],
    href: "/app/prospects",
  },
  {
    key: "quinn",
    name: "Quinn",
    role: "Campaign writer",
    line: "Builds the campaign and writes a note for each person on it.",
    does: [
      "Writes every connection note from that person's own role, company and headline.",
      "Splits a campaign across angles you can test, and never calls a winner early.",
      "Hands you a draft — nothing is sent until you press Launch.",
    ],
    href: "/app/campaigns",
  },
  {
    key: "reese",
    name: "Reese",
    role: "Outreach & booking",
    line: "Sends, follows up, answers replies and books the meeting.",
    does: [
      "Sends invitations and follow-ups under daily caps, spread across your working hours.",
      "Answers replies only from facts you gave it, and holds what you want to see first.",
      "Offers only real slots from your availability — never an invented time — and books the one they accept.",
    ],
    href: "/app/inbox",
  },
];

export const TEAM_MEMBER = Object.fromEntries(TEAM.map((m) => [m.key, m])) as Record<
  MemberKey,
  TeamMember
>;

/* ------------------------------------------------------------- live status */

/**
 * What the dashboard already knows, gathered for the team panel.
 *
 * Every field is read from the workspace's own rows. Nothing here is a guess
 * about what an agent is "probably" doing: a status line that says "working"
 * about a job nobody queued is rule 17's disease — a screen reporting a stage
 * as fine because it could not look.
 */
export interface TeamFacts {
  strategyPhase: "absent" | "running" | "failed" | "ready";
  strategiesApproved: number;
  strategiesAwaiting: number;
  prospectsFound: number;
  campaignsTotal: number;
  campaignsRunning: number;
  campaignsDraft: number;
  invited: number;
  replied: number;
  meetings: number;
  /** Whether any campaign here can reach the meetings stage at all (rule 29). */
  meetingsCounted: boolean;
  heldReplies: number;
  linkedInConnected: boolean;
  /** The length of the needs-you list (rule 50) — the same list, not a recount. */
  needsYou: number;
}

/**
 * `waiting` is waiting on *you*; `idle` is waiting on another teammate. The
 * difference is the whole point of the panel: one is a job for the reader,
 * the other is not.
 */
export type TeamState = "working" | "done" | "waiting" | "idle" | "blocked";

export interface TeamStatus {
  status: string;
  state: TeamState;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

export function teamStatus(f: TeamFacts): { lead: TeamStatus } & Record<MemberKey, TeamStatus> {
  const lead: TeamStatus =
    f.needsYou === 0
      ? { status: "Nothing needs you right now.", state: "done" }
      : {
          status: `${f.needsYou === 1 ? "One thing needs" : `${f.needsYou} things need`} you — listed at the top.`,
          state: "waiting",
        };

  const sage: TeamStatus =
    f.strategyPhase === "running"
      ? { status: "Reading your business and writing strategies.", state: "working" }
      : f.strategyPhase === "failed"
        ? { status: "Could not finish reading your business — try again.", state: "blocked" }
        : f.strategiesAwaiting > 0
          ? {
              status: `${plural(f.strategiesAwaiting, "strategy", "strategies")} waiting for your approval.`,
              state: "waiting",
            }
          : f.strategiesApproved > 0
            ? { status: `${plural(f.strategiesApproved, "strategy", "strategies")} approved.`, state: "done" }
            : { status: "Waiting to hear what you sell.", state: "waiting" };

  const scout: TeamStatus =
    f.prospectsFound > 0
      ? { status: `${plural(f.prospectsFound, "person", "people")} found.`, state: "done" }
      : f.strategiesApproved > 0
        ? { status: "Ready to search your approved strategies.", state: "idle" }
        : { status: "Waits for a strategy you have approved.", state: "idle" };

  const quinn: TeamStatus =
    f.campaignsTotal === 0
      ? f.prospectsFound > 0
        ? { status: "Ready to write your first campaign.", state: "idle" }
        : { status: "Waits for a list of people to write to.", state: "idle" }
      : {
          status: [
            `${plural(f.campaignsTotal, "campaign")} written`,
            f.campaignsRunning > 0 ? `${f.campaignsRunning.toLocaleString("en-GB")} running` : null,
            f.campaignsDraft > 0 ? `${f.campaignsDraft.toLocaleString("en-GB")} waiting for launch` : null,
          ]
            .filter(Boolean)
            .join(" · ") + ".",
          state: f.campaignsDraft > 0 ? "waiting" : "done",
        };

  let reese: TeamStatus;
  if (!f.linkedInConnected) {
    // Ahead of every count: with no account there is nothing Reese can send,
    // and a cheerful "14 invitations sent" over a broken connection is the
    // screen that looks fine while nothing moves.
    reese = { status: "Can't send until your LinkedIn account is connected.", state: "blocked" };
  } else if (f.invited === 0) {
    reese =
      f.campaignsRunning > 0
        ? { status: "No invitations sent yet — a launched campaign is queued.", state: "working" }
        : { status: "Nothing to send until a campaign is launched.", state: "idle" };
  } else {
    const parts = [plural(f.invited, "invitation") + " sent", plural(f.replied, "reply", "replies")];
    if (f.meetingsCounted) parts.push(plural(f.meetings, "meeting"));
    if (f.heldReplies > 0) parts.push(`${f.heldReplies.toLocaleString("en-GB")} held for you`);
    reese = {
      status: parts.join(" · ") + ".",
      state: f.heldReplies > 0 ? "waiting" : f.campaignsRunning > 0 ? "working" : "done",
    };
  }

  return { lead, sage, scout, quinn, reese };
}
