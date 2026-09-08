export interface BusyInterval {
  start: string;
  end: string;
}

export interface MeetingRequest {
  startsAt: string;
  endsAt: string;
  summary: string;
  description: string;
  /** Prospect email, when we have one. LinkedIn conversations often never yield one. */
  attendeeEmail?: string;
  timezone: string;
}

export interface CreatedMeeting {
  eventId: string;
  meetingUrl?: string;
  htmlLink?: string;
}

/**
 * What the Reply Agent needs from a calendar: what is already taken, and the
 * ability to put something in. Kept this small so a second provider (Microsoft
 * 365, Cal.com) is a sibling file rather than a rewrite.
 */
export interface CalendarProvider {
  readonly name: string;
  /** Busy intervals between two instants, merged across the rep's calendars. */
  getBusy(input: { accessToken: string; from: string; to: string; calendarIds?: string[] }): Promise<BusyInterval[]>;
  createMeeting(input: { accessToken: string; calendarId?: string; request: MeetingRequest }): Promise<CreatedMeeting>;
}

export class CalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "CalendarError";
  }
}
