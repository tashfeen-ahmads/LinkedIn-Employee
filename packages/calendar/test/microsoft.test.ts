import { describe, expect, it, vi } from "vitest";
import { MicrosoftCalendarProvider, refreshMicrosoftAccessToken } from "../src/microsoft.js";
import { CalendarError } from "../src/provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("MicrosoftCalendarProvider.getBusy", () => {
  it("reads busy blocks out of getSchedule", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        value: [
          {
            scheduleItems: [
              { status: "busy", start: { dateTime: "2026-09-10T09:00:00" }, end: { dateTime: "2026-09-10T10:00:00" } },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const busy = await new MicrosoftCalendarProvider({ fetchImpl }).getBusy({
      accessToken: "t",
      from: "2026-09-10T00:00:00Z",
      to: "2026-09-11T00:00:00Z",
    });

    expect(busy).toEqual([{ start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" }]);
  });

  it("does not treat free or working-elsewhere blocks as conflicts", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        value: [
          {
            scheduleItems: [
              { status: "free", start: { dateTime: "2026-09-10T09:00:00" }, end: { dateTime: "2026-09-10T10:00:00" } },
              {
                status: "workingElsewhere",
                start: { dateTime: "2026-09-10T11:00:00" },
                end: { dateTime: "2026-09-10T12:00:00" },
              },
              { status: "oof", start: { dateTime: "2026-09-10T14:00:00" }, end: { dateTime: "2026-09-10T15:00:00" } },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const busy = await new MicrosoftCalendarProvider({ fetchImpl }).getBusy({
      accessToken: "t",
      from: "2026-09-10T00:00:00Z",
      to: "2026-09-11T00:00:00Z",
    });

    // Out of office is a conflict; free and working-elsewhere are not.
    expect(busy).toHaveLength(1);
    expect(busy[0]?.start).toContain("14:00");
  });

  it("keeps an offset that Graph already supplied", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        value: [
          {
            scheduleItems: [
              { status: "busy", start: { dateTime: "2026-09-10T09:00:00+02:00" }, end: { dateTime: "2026-09-10T10:00:00+02:00" } },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const busy = await new MicrosoftCalendarProvider({ fetchImpl }).getBusy({
      accessToken: "t",
      from: "2026-09-10T00:00:00Z",
      to: "2026-09-11T00:00:00Z",
    });

    expect(busy[0]?.start).toBe("2026-09-10T07:00:00.000Z");
  });

  it("throws rather than reporting a free calendar it could not read", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "forbidden" }, 403)) as unknown as typeof fetch;
    await expect(
      new MicrosoftCalendarProvider({ fetchImpl }).getBusy({ accessToken: "t", from: "a", to: "b" }),
    ).rejects.toBeInstanceOf(CalendarError);
  });
});

describe("MicrosoftCalendarProvider.createMeeting", () => {
  it("returns the Teams join link", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: "evt1", webLink: "https://outlook.test/evt1", onlineMeeting: { joinUrl: "https://teams.test/join" } }),
    ) as unknown as typeof fetch;

    const created = await new MicrosoftCalendarProvider({ fetchImpl }).createMeeting({
      accessToken: "t",
      request: {
        startsAt: "2026-09-10T09:00:00Z",
        endsAt: "2026-09-10T09:30:00Z",
        summary: "Intro",
        description: "",
        timezone: "UTC",
      },
    });

    expect(created).toEqual({
      eventId: "evt1",
      htmlLink: "https://outlook.test/evt1",
      meetingUrl: "https://teams.test/join",
    });
  });
});

describe("refreshMicrosoftAccessToken", () => {
  it("keeps the existing refresh token when the response omits one", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "new", expires_in: 3600 }),
    ) as unknown as typeof fetch;

    const tokens = await refreshMicrosoftAccessToken(
      { refreshToken: "keep_me", clientId: "id", clientSecret: "secret" },
      fetchImpl,
    );

    expect(tokens.refreshToken).toBe("keep_me");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });
});
