import type { Db } from "@le/db";

export interface PlatformSettings {
  outreachPausedAt: string | null;
  outreachPausedReason: string | null;
  supportAutopilot: boolean;
}

/** What a deployment with no settings row has always done. */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  outreachPausedAt: null,
  outreachPausedReason: null,
  supportAutopilot: true,
};

/**
 * The one row of platform-wide switches (migration 0041).
 *
 * A missing row is the defaults: nothing paused. A row that cannot be **read**
 * is not — see `outreachPause`.
 */
export async function loadPlatformSettings(db: Db): Promise<{ settings: PlatformSettings; error: string | null }> {
  const { data, error } = await db
    .from("platform_settings")
    .select("outreach_paused_at, outreach_paused_reason, support_autopilot")
    .maybeSingle();
  if (error) return { settings: DEFAULT_PLATFORM_SETTINGS, error: error.message };
  if (!data) return { settings: DEFAULT_PLATFORM_SETTINGS, error: null };
  return {
    settings: {
      outreachPausedAt: data.outreach_paused_at,
      outreachPausedReason: data.outreach_paused_reason,
      supportAutopilot: data.support_autopilot !== false,
    },
    error: null,
  };
}

/**
 * Why outreach is paused platform-wide, or null when it is not.
 *
 * The operator's kill switch: set during a LinkedIn crackdown or an incident,
 * every invitation, profile view and follow-up waits and nothing is failed —
 * lifting it resumes the queue where it stood.
 *
 * A settings row that cannot be read reads as **paused**. This is a switch
 * somebody pressed to stop sending, and a database hiccup must not be the
 * thing that quietly turns it off; the cost of being wrong that way is
 * invitations going out from accounts the operator was trying to protect,
 * while the cost of being wrong the other way is a half-hour wait.
 */
export async function outreachPause(db: Db): Promise<string | null> {
  const { settings, error } = await loadPlatformSettings(db);
  if (error) return `platform settings could not be read (${error})`;
  if (!settings.outreachPausedAt) return null;
  return settings.outreachPausedReason?.trim() || "paused by the operator";
}

/** How long a paused action waits before it asks again. */
export const OUTREACH_PAUSE_RETRY_MS = 30 * 60_000;
