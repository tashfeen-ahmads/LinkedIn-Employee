import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";

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
  /**
   * The personalised note on each queued prospect, null where there is none.
   *
   * Optional so a caller that has not read them yet still gets every other
   * check; a caller that has read them gets the one that matters most on a
   * list the agent wrote.
   */
  inviteNotes?: ReadonlyArray<string | null>;
}


export function launchBlockers(state: LaunchState): string[] {
  const blockers: string[] = [];

  if (state.prospectCount === 0) {
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
      state.accountStatus === null
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
