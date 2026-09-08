import { CalendarError, type BusyInterval, type CalendarProvider, type CreatedMeeting, type MeetingRequest } from "./provider.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * Microsoft 365 via Graph. Same contract as the Google adapter, so the Reply
 * Agent cannot tell them apart.
 *
 * Graph's getSchedule returns free/busy without exposing what the meetings are,
 * which keeps the scopes as narrow here as they are on the Google side.
 */
export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly name = "microsoft_calendar";
  private readonly fetchImpl: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getBusy(input: {
    accessToken: string;
    from: string;
    to: string;
    calendarIds?: string[];
  }): Promise<BusyInterval[]> {
    const res = await this.fetchImpl(`${GRAPH}/me/calendar/getSchedule`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        // getSchedule is addressed by mailbox; "me" resolves via the token.
        schedules: input.calendarIds?.length ? input.calendarIds : ["me"],
        startTime: { dateTime: input.from, timeZone: "UTC" },
        endTime: { dateTime: input.to, timeZone: "UTC" },
        availabilityViewInterval: 30,
      }),
    });

    const text = await res.text();
    if (!res.ok) throw new CalendarError(`getSchedule failed with ${res.status}`, res.status, text);

    const parsed = JSON.parse(text) as {
      value?: Array<{
        scheduleItems?: Array<{ status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }>;
      }>;
    };

    const busy: BusyInterval[] = [];
    for (const schedule of parsed.value ?? []) {
      for (const item of schedule.scheduleItems ?? []) {
        // "free" and "workingElsewhere" are not conflicts; everything else is.
        if (item.status === "free" || item.status === "workingElsewhere") continue;
        const start = item.start?.dateTime;
        const end = item.end?.dateTime;
        if (start && end) busy.push({ start: toIso(start), end: toIso(end) });
      }
    }
    return busy;
  }

  async createMeeting(input: {
    accessToken: string;
    calendarId?: string;
    request: MeetingRequest;
  }): Promise<CreatedMeeting> {
    const path = input.calendarId ? `/me/calendars/${encodeURIComponent(input.calendarId)}/events` : "/me/events";

    const res = await this.fetchImpl(`${GRAPH}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        subject: input.request.summary,
        body: { contentType: "text", content: input.request.description },
        start: { dateTime: input.request.startsAt, timeZone: input.request.timezone },
        end: { dateTime: input.request.endsAt, timeZone: input.request.timezone },
        ...(input.request.attendeeEmail
          ? { attendees: [{ emailAddress: { address: input.request.attendeeEmail }, type: "required" }] }
          : {}),
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
      }),
    });

    const text = await res.text();
    if (!res.ok) throw new CalendarError(`event create failed with ${res.status}`, res.status, text);

    const event = JSON.parse(text) as {
      id: string;
      webLink?: string;
      onlineMeeting?: { joinUrl?: string };
    };
    return { eventId: event.id, htmlLink: event.webLink, meetingUrl: event.onlineMeeting?.joinUrl };
  }
}

/** Graph returns naive datetimes in the requested zone; mark them as UTC. */
function toIso(value: string): string {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? new Date(value).toISOString() : new Date(`${value}Z`).toISOString();
}

export const MICROSOFT_CALENDAR_SCOPES = [
  "offline_access",
  "Calendars.ReadWrite",
] as const;

export function microsoftConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  tenant?: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    state: input.state,
  });
  return `https://login.microsoftonline.com/${input.tenant ?? "common"}/oauth2/v2.0/authorize?${params.toString()}`;
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export async function exchangeMicrosoftCode(
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string; tenant?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftTokens> {
  return microsoftToken(
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    },
    input.tenant,
    fetchImpl,
  );
}

export async function refreshMicrosoftAccessToken(
  input: { refreshToken: string; clientId: string; clientSecret: string; tenant?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftTokens> {
  const tokens = await microsoftToken(
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
      scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    },
    input.tenant,
    fetchImpl,
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? input.refreshToken };
}

async function microsoftToken(
  body: Record<string, string>,
  tenant: string | undefined,
  fetchImpl: typeof fetch,
): Promise<MicrosoftTokens> {
  const res = await fetchImpl(`https://login.microsoftonline.com/${tenant ?? "common"}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  const text = await res.text();
  if (!res.ok) throw new CalendarError(`Microsoft token request failed with ${res.status}`, res.status, text);

  const parsed = JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + (parsed.expires_in - 60) * 1000,
  };
}
