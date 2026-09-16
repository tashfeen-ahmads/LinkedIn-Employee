import type { BusyInterval, CalendarProvider, CreatedMeeting, MeetingRequest } from "./provider.js";

/**
 * Everything the rep has told us they are not free for.
 *
 * An own calendar cannot see a meeting booked anywhere else, so this is the
 * whole of what it knows: the meetings this product booked, and the times the
 * rep blocked out by hand. Both have to be passed in — the package stays free
 * of a database, so the worker fetches and this decides.
 */
export interface OwnCalendarState {
  /** Meetings already booked for this rep, cancelled ones excluded by the caller. */
  meetings: BusyInterval[];
  /** Time the rep declared unavailable. */
  blackouts: BusyInterval[];
}

/**
 * A calendar backed by this product's own database.
 *
 * It exists because Google will not grant calendar scopes to an unverified app,
 * and verification needs a verified domain and a review measured in weeks — so
 * the final stage of this product, the one the rest of it exists to reach,
 * could not be demonstrated at all on a test deployment.
 *
 * The trade is stated rather than hidden: this knows about meetings we booked
 * and time the rep blocked out, and nothing else. A rep who takes a call in
 * their personal calendar and does not block it here can be double-booked, and
 * every screen that touches availability says so.
 *
 * `createMeeting` writes nothing. The `meetings` table is this calendar — a
 * second copy of the same event would be one more thing to keep in step, and
 * the row the booking job inserts moments later is what `getBusy` reads next
 * time. The id returned is the one that row is inserted with, so the event id
 * and the meeting are the same fact.
 */
export class OwnCalendarProvider implements CalendarProvider {
  readonly name = "own";

  constructor(private readonly state: OwnCalendarState) {}

  async getBusy(input: { from: string; to: string }): Promise<BusyInterval[]> {
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    return [...this.state.meetings, ...this.state.blackouts].filter((interval) => {
      const start = Date.parse(interval.start);
      const end = Date.parse(interval.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      // Overlapping the window, not contained by it: a blackout that began
      // yesterday and runs until Friday blocks Thursday, and a filter that
      // asked for containment would drop it and offer the time anyway.
      return start < to && end > from;
    });
  }

  async createMeeting(input: { request: MeetingRequest }): Promise<CreatedMeeting> {
    return { eventId: `own_${input.request.startsAt}` };
  }
}
