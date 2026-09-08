import type { BusyInterval, CalendarProvider, CreatedMeeting, MeetingRequest } from "./provider.js";

/** In-memory calendar for development and tests. */
export class MockCalendarProvider implements CalendarProvider {
  readonly name = "mock";
  busy: BusyInterval[] = [];
  readonly created: MeetingRequest[] = [];

  async getBusy(): Promise<BusyInterval[]> {
    return this.busy;
  }

  async createMeeting(input: { request: MeetingRequest }): Promise<CreatedMeeting> {
    this.created.push(input.request);
    this.busy.push({ start: input.request.startsAt, end: input.request.endsAt });
    return {
      eventId: `evt_${this.created.length}`,
      meetingUrl: "https://meet.example.test/mock",
      htmlLink: "https://calendar.example.test/mock",
    };
  }
}
