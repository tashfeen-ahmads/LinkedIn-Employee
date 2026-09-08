import { CalendarError, type BusyInterval, type CalendarProvider, type CreatedMeeting, type MeetingRequest } from "./provider.js";

const API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Google Calendar. Reads freebusy rather than event details, so the scopes stay
 * narrow: we need to know when the rep is busy, not what they are doing.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google_calendar";
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
    const items = (input.calendarIds?.length ? input.calendarIds : ["primary"]).map((id) => ({ id }));
    const res = await this.fetchImpl(`${API}/freeBusy`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ timeMin: input.from, timeMax: input.to, items }),
    });

    const text = await res.text();
    if (!res.ok) throw new CalendarError(`freeBusy failed with ${res.status}`, res.status, text);

    const parsed = JSON.parse(text) as {
      calendars?: Record<string, { busy?: BusyInterval[]; errors?: Array<{ reason: string }> }>;
    };

    const busy: BusyInterval[] = [];
    for (const calendar of Object.values(parsed.calendars ?? {})) {
      // A calendar we cannot read is treated as fully unknown, not as free:
      // offering a slot over an existing meeting is worse than offering fewer.
      if (calendar.errors?.length) continue;
      busy.push(...(calendar.busy ?? []));
    }
    return busy;
  }

  async createMeeting(input: {
    accessToken: string;
    calendarId?: string;
    request: MeetingRequest;
  }): Promise<CreatedMeeting> {
    const calendarId = encodeURIComponent(input.calendarId ?? "primary");
    const body = {
      summary: input.request.summary,
      description: input.request.description,
      start: { dateTime: input.request.startsAt, timeZone: input.request.timezone },
      end: { dateTime: input.request.endsAt, timeZone: input.request.timezone },
      ...(input.request.attendeeEmail ? { attendees: [{ email: input.request.attendeeEmail }] } : {}),
      conferenceData: {
        createRequest: {
          requestId: `le-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };

    const res = await this.fetchImpl(
      `${API}/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const text = await res.text();
    if (!res.ok) throw new CalendarError(`event insert failed with ${res.status}`, res.status, text);

    const event = JSON.parse(text) as {
      id: string;
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    };

    const videoEntry = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video");
    return { eventId: event.id, htmlLink: event.htmlLink, meetingUrl: event.hangoutLink ?? videoEntry?.uri };
  }
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Exchanges a refresh token for a fresh access token. Access tokens last an
 * hour, and a campaign runs for weeks, so every calendar call refreshes first.
 */
export async function refreshGoogleAccessToken(
  input: { refreshToken: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new CalendarError(`token refresh failed with ${res.status}`, res.status, text);

  const parsed = JSON.parse(text) as { access_token: string; expires_in: number; refresh_token?: string };
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? input.refreshToken,
    expiresAt: Date.now() + (parsed.expires_in - 60) * 1000,
  };
}

/** Scopes the product needs: busy times, and the ability to add one event. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export function googleConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new CalendarError(`code exchange failed with ${res.status}`, res.status, text);

  const parsed = JSON.parse(text) as { access_token: string; expires_in: number; refresh_token?: string };
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + (parsed.expires_in - 60) * 1000,
  };
}
