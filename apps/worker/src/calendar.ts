import {
  GoogleCalendarProvider,
  MicrosoftCalendarProvider,
  MockCalendarProvider,
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
}

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
    return { provider: new MockCalendarProvider(), accessToken: "mock", timezone: input.timezone };
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
  const clientSecret = microsoft ? env.MICROSOFT_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
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
        : refreshGoogleAccessToken({ refreshToken: current.refreshToken!, clientId, clientSecret }),
  });
  if (!tokens) return null;

  return {
    provider: microsoft ? new MicrosoftCalendarProvider() : new GoogleCalendarProvider(),
    accessToken: tokens.accessToken,
    timezone: input.timezone,
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
  input: { workingHours: { start: number; end: number; days: number[] }; durationMinutes: number },
): Promise<SlotOffer> {
  const from = new Date();
  const to = new Date(from.getTime() + 10 * 86_400_000);

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
    durationMinutes: input.durationMinutes,
    workingHours: input.workingHours,
    timezone: binding.timezone,
    busy,
  });

  return { iso, readable: iso.map((slot) => formatSlot(slot, binding.timezone)) };
}
