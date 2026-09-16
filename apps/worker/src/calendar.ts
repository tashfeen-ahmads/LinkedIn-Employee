import {
  GoogleCalendarProvider,
  MicrosoftCalendarProvider,
  MockCalendarProvider,
  OwnCalendarProvider,
  findFreeSlots,
  formatSlot,
  refreshGoogleAccessToken,
  refreshMicrosoftAccessToken,
  type CalendarProvider,
} from "@le/calendar";
import type { Db } from "@le/db";
import type { Env } from "./config.js";
import { loadRefreshedCredential } from "./oauth-credentials.js";

export interface CalendarBinding {
  provider: CalendarProvider;
  accessToken: string;
  timezone: string;
  /** How long a meeting is, and how far ahead the rep will take one. */
  rules: BookingRules;
  /** True when the only thing this calendar knows is what we put in it. */
  ownOnly: boolean;
}

export interface BookingRules {
  meetingMinutes: number;
  minNoticeHours: number;
  bufferMinutes: number;
  maxPerDay: number;
  workingHours: { start: number; end: number; days: number[] };
  location: string | null;
}

/**
 * What a rep gets before they have set anything. Nine to five on weekdays, half
 * an hour, half a day's notice — the shape of a working week rather than a
 * placeholder, because a rep who never opens the settings page should still
 * have a calendar that offers sensible times rather than none.
 */
export const DEFAULT_BOOKING_RULES: BookingRules = {
  meetingMinutes: 30,
  minNoticeHours: 12,
  bufferMinutes: 15,
  maxPerDay: 3,
  workingHours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
  location: null,
};

/**
 * Resolves a rep's calendar, refreshing the access token when it has expired.
 * Returns null when no calendar is connected — the Reply Agent then offers to
 * send times rather than inventing any.
 */
export async function resolveCalendar(
  db: Db,
  env: Env,
  input: { workspaceId: string; userId: string; timezone: string },
): Promise<CalendarBinding | null> {
  if (env.CALENDAR_PROVIDER === "mock") {
    return {
      provider: new MockCalendarProvider(),
      accessToken: "mock",
      timezone: input.timezone,
      rules: DEFAULT_BOOKING_RULES,
      ownOnly: false,
    };
  }

  // Our own calendar, and the default. Google will not grant calendar scopes to
  // an unverified app, so requiring one made the last stage of this product --
  // the stage the rest of it exists to reach -- impossible to demonstrate on a
  // deployment that does not yet have a verified domain.
  if (env.CALENDAR_PROVIDER === "own") {
    return buildOwnCalendar(db, input);
  }

  // A rep connects one calendar, whichever it is. Both are per-user, unlike the
  // CRM, because the times offered must be that rep's own.
  const { data: integration } = await db
    .from("integrations")
    .select("id, kind, credentials_encrypted, config, status")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .in("kind", ["google_calendar", "microsoft_calendar"])
    .eq("status", "active")
    .maybeSingle();

  if (!integration?.credentials_encrypted || !env.CREDENTIALS_KEY) return null;

  const microsoft = integration.kind === "microsoft_calendar";
  const clientId = microsoft ? env.MICROSOFT_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const clientSecret = microsoft
    ? env.MICROSOFT_CLIENT_SECRET
    : env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokens = await loadRefreshedCredential(db, {
    integrationId: integration.id,
    credentialsEncrypted: integration.credentials_encrypted,
    key: env.CREDENTIALS_KEY,
    refresh: (current) =>
      microsoft
        ? refreshMicrosoftAccessToken({
            refreshToken: current.refreshToken!,
            clientId,
            clientSecret,
            tenant: env.MICROSOFT_TENANT,
          })
        : refreshGoogleAccessToken({
            refreshToken: current.refreshToken!,
            clientId,
            clientSecret,
          }),
  });
  if (!tokens) return null;

  // A connected Google or Microsoft calendar keeps the rep's own booking rules
  // -- meeting length and notice are the rep's preference, not the provider's
  // -- but it is not ownOnly: it can see meetings booked elsewhere.
  const { data: settings } = await db
    .from("availability")
    .select(
      "timezone, working_hours, meeting_minutes, min_notice_hours, buffer_minutes, max_per_day, location",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .maybeSingle();

  return {
    provider: microsoft
      ? new MicrosoftCalendarProvider()
      : new GoogleCalendarProvider(),
    accessToken: tokens.accessToken,
    timezone: settings?.timezone || input.timezone,
    rules: toRules(settings),
    ownOnly: false,
  };
}

export interface SlotOffer {
  /** ISO datetimes, the only times the agent may name. */
  iso: string[];
  /** The same slots rendered for a human, passed to the model as context. */
  readable: string[];
}

export async function offerSlots(
  binding: CalendarBinding,
  input: {
    workingHours?: { start: number; end: number; days: number[] };
    durationMinutes?: number;
    /** A message carries three; a page can show a choice. */
    maxSlots?: number;
  } = {},
): Promise<SlotOffer> {
  const from = new Date();
  // Far enough ahead that a rep who works three days a week still has options,
  // and near enough that a prospect is not offered a time they will forget.
  const to = new Date(from.getTime() + 14 * 86_400_000);

  let busy: Awaited<ReturnType<CalendarProvider["getBusy"]>> = [];
  try {
    busy = await binding.provider.getBusy({
      accessToken: binding.accessToken,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  } catch {
    // A calendar we cannot read means we offer nothing, never a guess.
    return { iso: [], readable: [] };
  }

  const iso = findFreeSlots({
    from,
    to,
    // The rep's own booking rules, not the caller's guess at them. Meeting
    // length, notice and buffer are the difference between a calendar that
    // offers usable times and one that offers a slot in ninety minutes.
    durationMinutes: input.durationMinutes ?? binding.rules.meetingMinutes,
    workingHours: input.workingHours ?? binding.rules.workingHours,
    minNoticeHours: binding.rules.minNoticeHours,
    bufferMinutes: binding.rules.bufferMinutes,
    maxSlots: input.maxSlots,
    timezone: binding.timezone,
    busy,
  });

  return {
    iso,
    readable: iso.map((slot) => formatSlot(slot, binding.timezone)),
  };
}

/**
 * The rep's own calendar: their declared hours, the meetings we booked, and the
 * time they blocked out.
 *
 * Everything here is fetched rather than inferred. A rep with no availability
 * row still gets a working calendar on the defaults — the alternative is a
 * product whose final stage silently does nothing until someone finds a
 * settings page.
 */
async function buildOwnCalendar(
  db: Db,
  input: { workspaceId: string; userId: string; timezone: string },
): Promise<CalendarBinding> {
  const horizonFrom = new Date(Date.now() - 86_400_000).toISOString();
  const horizonTo = new Date(Date.now() + 45 * 86_400_000).toISOString();

  const [
    { data: settings },
    { data: meetings },
    { data: blackouts },
    { data: feedBusy },
    { data: feed },
  ] = await Promise.all([
    db
      .from("availability")
      .select(
        "timezone, working_hours, meeting_minutes, min_notice_hours, buffer_minutes, max_per_day, location",
      )
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .maybeSingle(),
    db
      .from("meetings")
      .select("starts_at, ends_at")
      .eq("rep_user_id", input.userId)
      .is("cancelled_at", null)
      .neq("status", "cancelled")
      .gte("starts_at", horizonFrom)
      .lte("starts_at", horizonTo),
    db
      .from("availability_blackouts")
      .select("starts_at, ends_at")
      .eq("user_id", input.userId)
      .gte("ends_at", horizonFrom)
      .lte("starts_at", horizonTo),
    // What the rep's real calendar says, from the last successful read of their
    // published feed. Taken from that read rather than fetched now: a booking
    // page that called out to Google on every render would be slow, would tell
    // Google's logs when this product is being used, and would fail the booking
    // outright whenever that host had a bad minute.
    db
      .from("calendar_feed_busy")
      .select("starts_at, ends_at")
      .eq("user_id", input.userId)
      .gte("ends_at", horizonFrom)
      .lte("starts_at", horizonTo),
    db
      .from("calendar_feeds")
      .select("status, last_synced_at, url_host")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);

  const toInterval = (row: { starts_at: string; ends_at: string }) => ({
    start: row.starts_at,
    end: row.ends_at,
  });

  return {
    provider: new OwnCalendarProvider({
      meetings: (meetings ?? []).map(toInterval),
      // One list. A block is a block, whether the rep typed it or their own
      // calendar did -- keeping them apart would only invite a caller to
      // consult one and forget the other.
      blackouts: [...(blackouts ?? []), ...(feedBusy ?? [])].map(toInterval),
    }),
    accessToken: "own",
    timezone: settings?.timezone || input.timezone,
    rules: toRules(settings),
    // Still own-only when the feed is failing: a snapshot going stale is not a
    // calendar we can see, and the screens say so rather than implying the
    // rep's real diary is being watched when the last read of it broke.
    ownOnly: !feed || feed.status !== "ok",
  };
}

/** A settings row, or the defaults when the rep has never opened the page. */
function toRules(
  settings: {
    working_hours: unknown;
    meeting_minutes: number;
    min_notice_hours: number;
    buffer_minutes: number;
    max_per_day: number;
    location: string | null;
  } | null,
): BookingRules {
  if (!settings) return DEFAULT_BOOKING_RULES;
  return {
    meetingMinutes: settings.meeting_minutes,
    minNoticeHours: settings.min_notice_hours,
    bufferMinutes: settings.buffer_minutes,
    maxPerDay: settings.max_per_day,
    workingHours: parseHours(settings.working_hours),
    location: settings.location ?? null,
  };
}

function parseHours(value: unknown): {
  start: number;
  end: number;
  days: number[];
} {
  if (value && typeof value === "object") {
    const v = value as { start?: unknown; end?: unknown; days?: unknown };
    if (
      typeof v.start === "number" &&
      typeof v.end === "number" &&
      Array.isArray(v.days)
    ) {
      return { start: v.start, end: v.end, days: v.days as number[] };
    }
  }
  return DEFAULT_BOOKING_RULES.workingHours;
}
