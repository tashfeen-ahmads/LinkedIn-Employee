import {
  IDLE_RELEASE_TAGLINE,
  INVITE_NOTE_MAX_CHARS,
  LINKEDIN_LIMITS,
  matchExclusion,
  type ExclusionRule,
} from "@le/shared";

/**
 * What has to be true before a campaign may start sending.
 *
 * Pure, and separate from the page, because "Launch" is the one button in this
 * product that reaches strangers. Every reason it is refused is a sentence the
 * person reads, not a disabled button with no explanation.
 */
export interface LaunchState {
  connectionNote: string;
  steps: ReadonlyArray<{ message: string; delayDays: number }>;
  dailyInviteCap: number;
  prospectCount: number;
  /** The status of the LinkedIn account the campaign sends from, if connected. */
  accountStatus: string | null;
  /** The account was released after a fortnight unused (rule 63): say how to come back. */
  accountReleasedIdle?: boolean;
  /**
   * The personalised note on each queued prospect, null where there is none.
   *
   * Optional so a caller that has not read them yet still gets every other
   * check; a caller that has read them gets the one that matters most on a
   * list the agent wrote.
   */
  inviteNotes?: ReadonlyArray<string | null>;
  /**
   * The campaign has been launched before, so this is a resume. Its queue can
   * be empty while people who accepted are part-way through their follow-ups,
   * and refusing the resume would leave them stranded on a paused campaign.
   */
  resuming?: boolean;
}


export function launchBlockers(state: LaunchState): string[] {
  const blockers: string[] = [];

  if (state.prospectCount === 0 && !state.resuming) {
    blockers.push("There is nobody on the list yet.");
  }

  const note = state.connectionNote.trim();
  if (!note) {
    blockers.push("The connection note is empty.");
  } else if (note.length > INVITE_NOTE_MAX_CHARS) {
    // The send path's own cap, imported rather than retyped. This read 300
    // while the send path drops anything over 200, so the review screen
    // passed notes that LinkedIn then refused outright — the whole invitation,
    // not the tail of it — or that went out as no note at all.
    blockers.push(
      `The connection note is ${note.length} characters. LinkedIn allows ${INVITE_NOTE_MAX_CHARS}.`,
    );
  }

  /*
   * The notes written per person, held to the same cap as the template.
   *
   * Checking only the campaign's template passed a live draft on which 11 of
   * 18 personalised notes were over the limit. The send path does not send
   * those — LinkedIn refuses the whole invitation — so each one silently fell
   * back to the template: a list reviewed as personalised that would mostly
   * have gone out generic, which is the silent degradation rule 27 forbids.
   * Said here, with the count, so it is fixed (shortened by hand, or Rewrite
   * notes) before anybody presses Launch.
   */
  const overLength = (state.inviteNotes ?? []).filter(
    (personal) => (personal?.trim().length ?? 0) > INVITE_NOTE_MAX_CHARS,
  ).length;
  if (overLength > 0) {
    blockers.push(
      `${overLength} personalised ${overLength === 1 ? "note is" : "notes are"} over LinkedIn's ${INVITE_NOTE_MAX_CHARS}-character limit, so ${overLength === 1 ? "it" : "they"} would go out as the campaign template instead. Shorten ${overLength === 1 ? "it" : "them"} or rewrite the notes.`,
    );
  }

  // No sequence at all is a campaign that invites people and then says
  // nothing to anybody who accepts — the one outcome it exists to produce.
  if (state.steps.length === 0) {
    blockers.push("This campaign has no follow-up messages, so nobody who accepts would hear from you.");
  }

  // A blank follow-up would send an empty message to someone who accepted.
  const blank = state.steps.findIndex((step) => !step.message.trim());
  if (blank !== -1) {
    blockers.push(`Follow-up ${blank + 1} has no message.`);
  }

  if (state.accountStatus !== "active") {
    blockers.push(
      state.accountReleasedIdle
        ? IDLE_RELEASE_TAGLINE
        : state.accountStatus === null
        ? "No LinkedIn account is connected to this campaign."
        : `The LinkedIn account for this campaign is ${state.accountStatus}.`,
    );
  }

  // The caps are product rules; a campaign may ask for less, never for more.
  if (state.dailyInviteCap > LINKEDIN_LIMITS.invitesPerDayMax) {
    blockers.push(
      `A daily cap of ${state.dailyInviteCap} is above the safe ceiling of ${LINKEDIN_LIMITS.invitesPerDayMax}.`,
    );
  }
  if (state.dailyInviteCap < 1) {
    blockers.push("The daily cap is zero, so nothing would send.");
  }

  return blockers;
}

/**
 * How long the queue takes to work through at the campaign's own cap. Reps
 * consistently expect a list of 400 to go out this week; saying so up front is
 * cheaper than explaining it afterwards.
 */
export function daysToSendAll(prospectCount: number, dailyInviteCap: number): number | null {
  if (prospectCount === 0 || dailyInviteCap < 1) return null;
  return Math.ceil(prospectCount / dailyInviteCap);
}

/**
 * A queued row as the send path will judge it.
 *
 * `prospect` is the joined `prospects` row; only the fields the send path
 * reads before it sends an invitation are needed.
 */
export interface QueuedRow {
  invited_at?: string | null;
  prospect: {
    do_not_contact?: boolean | null;
    last_contacted_at?: string | null;
    company?: string | null;
    linkedin_url?: string | null;
  } | null;
}

/**
 * How many queued people will actually be invited, and how many the send path
 * will close instead.
 *
 * The pacing loop queues every `queued` row, and the send path then closes
 * three kinds without sending: somebody marked do not contact, somebody this
 * workspace has already contacted (rule 24), and somebody on the exclusion
 * list (rule 14). Counting them as "still to invite" promised invitations
 * that were never going to go out, and stretched the days estimate with them.
 * Judged with the same `matchExclusion` the send path calls, never a second
 * reading of it.
 */
export function actionableQueue(
  rows: ReadonlyArray<QueuedRow>,
  exclusions: ReadonlyArray<ExclusionRule>,
): { actionable: number; skipped: number } {
  let skipped = 0;
  for (const row of rows) {
    const p = row.prospect;
    const skip =
      Boolean(p?.do_not_contact) ||
      Boolean(!row.invited_at && p?.last_contacted_at) ||
      Boolean(
        p && matchExclusion(exclusions, { company: p.company ?? null, linkedinUrl: p.linkedin_url ?? null }),
      );
    if (skip) skipped += 1;
  }
  return { actionable: rows.length - skipped, skipped };
}

export const SKIPPED_AT_SEND_REASONS =
  "on your exclusion list, marked do not contact, or already contacted";

/**
 * How long the queue takes, in working days, at the pace the loop will keep.
 *
 * Two ceilings, not one. `perDay` is the campaign's cap or the account's ramp;
 * the rolling week (`LINKEDIN_LIMITS.invitesPerWeek`) is shared by everything
 * the account sends, and spread over the account's own working days it is the
 * lower of the two for any account past its first week of ramp: 35 a day five
 * days a week is 175, and the week stops at 100. An estimate at the daily cap
 * promised a list of 400 in twelve days that takes twenty.
 *
 * Other running campaigns on the same account draw on the same two
 * allowances. How the loop divides them depends on whose prospects come due
 * first, so the estimate does not guess a split; it says the count, and the
 * screen says the number is the best case.
 */
export function sendEstimate(input: {
  remaining: number;
  perDay: number;
  workingDaysPerWeek: number;
  otherRunningOnAccount?: number;
}): { days: number; perDay: number; weeklyLimited: boolean; shared: number } | null {
  if (input.remaining <= 0 || input.perDay < 1) return null;
  const workingDays = Math.min(7, Math.max(1, Math.floor(input.workingDaysPerWeek) || 5));
  const weeklyPerDay = Math.floor(LINKEDIN_LIMITS.invitesPerWeek / workingDays);
  const pace = Math.max(1, Math.min(input.perDay, weeklyPerDay));
  return {
    days: Math.ceil(input.remaining / pace),
    perDay: pace,
    weeklyLimited: weeklyPerDay < input.perDay,
    shared: Math.max(0, input.otherRunningOnAccount ?? 0),
  };
}
