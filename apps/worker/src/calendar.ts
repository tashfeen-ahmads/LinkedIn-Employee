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
import { decryptJson, encryptJson } from "./crypto.js";

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

  if (!integration?.credentials_encrypted) return null;
  if (!env.CREDENTIALS_KEY) return null;

  if (integration.kind === "microsoft_calendar") {
    if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) return null;
    try {
      let tokens = decryptJson<{ accessToken: string; refreshToken?: string; expiresAt: number }>(
        integration.credentials_encrypted,
        env.CREDENTIALS_KEY,
      );
      if (tokens.expiresAt <= Date.now()) {
        if (!tokens.refreshToken) throw new Error("no refresh token");
        tokens = await refreshMicrosoftAccessToken({
          refreshToken: tokens.refreshToken,
          clientId: env.MICROSOFT_CLIENT_ID,
          clientSecret: env.MICROSOFT_CLIENT_SECRET,
          tenant: env.MICROSOFT_TENANT,
        });
        await db
          .from("integrations")
          .update({ credentials_encrypted: encryptJson(tokens, env.CREDENTIALS_KEY) })
          .eq("id", integration.id);
      }
      return {
        provider: new MicrosoftCalendarProvider(),
        accessToken: tokens.accessToken,
        timezone: input.timezone,
      };
    } catch {
      await db.from("integrations").update({ status: "reauth_required" }).eq("id", integration.id);
      return null;
    }
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;

  let tokens: { accessToken: string; refreshToken?: string; expiresAt: number };
  try {
    tokens = decryptJson(integration.credentials_encrypted, env.CREDENTIALS_KEY);
  } catch {
    await db.from("integrations").update({ status: "error" }).eq("id", integration.id);
    return null;
  }

  if (tokens.expiresAt <= Date.now()) {
    if (!tokens.refreshToken) {
      await db.from("integrations").update({ status: "reauth_required" }).eq("id", integration.id);
      return null;
    }
    try {
      const refreshed = await refreshGoogleAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      });
      tokens = refreshed;
      await db
        .from("integrations")
        .update({ credentials_encrypted: encryptJson(refreshed, env.CREDENTIALS_KEY) })
        .eq("id", integration.id);
    } catch {
      await db.from("integrations").update({ status: "reauth_required" }).eq("id", integration.id);
      return null;
    }
  }

  return {
    provider: new GoogleCalendarProvider(),
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
