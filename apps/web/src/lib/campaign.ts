import { LINKEDIN_LIMITS } from "@le/shared";

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
}

/** LinkedIn's own limit on a connection request note. */
export const CONNECTION_NOTE_MAX = 300;

export function launchBlockers(state: LaunchState): string[] {
  const blockers: string[] = [];

  if (state.prospectCount === 0) {
    blockers.push("There is nobody on the list yet.");
  }

  const note = state.connectionNote.trim();
  if (!note) {
    blockers.push("The connection note is empty.");
  } else if (note.length > CONNECTION_NOTE_MAX) {
    // LinkedIn silently truncates past this; a half-sentence invitation is
    // worse than none.
    blockers.push(
      `The connection note is ${note.length} characters. LinkedIn allows ${CONNECTION_NOTE_MAX}.`,
    );
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
