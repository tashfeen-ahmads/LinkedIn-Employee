import "server-only";
import type { Db } from "@le/db";

/**
 * Where the Strategy Agent has got to, for a workspace.
 *
 * Onboarding is the one step whose output somebody else writes. A person fills
 * in the form, the job is queued, and several minutes later the agent produces
 * the business profile — so for those minutes the only evidence they did
 * anything is a row that does not exist yet. The dashboard read that absence as
 * "they have not told us what they sell" and showed them a button to do it
 * again; one tester saw that for twenty-one minutes. A failed run showed the
 * same thing forever, with no reason anywhere.
 *
 * So it is read from the events the worker records, not inferred from what the
 * agent has managed to write.
 */
export type StrategyState =
  | { phase: "absent" }
  | { phase: "running"; since: string }
  | { phase: "failed"; reason: string; at: string }
  | { phase: "ready" };

const NAMES = ["strategy.queued", "strategy.profile.created", "strategy.failed"] as const;

export async function readStrategyState(
  supabase: Db,
  workspaceId: string,
  hasBusinessProfile: boolean,
): Promise<StrategyState> {
  // The profile existing is the strongest evidence there is, and it survives
  // an events table someone has pruned.
  if (hasBusinessProfile) return { phase: "ready" };

  const { data } = await supabase
    .from("events")
    .select("name, payload, created_at")
    .eq("workspace_id", workspaceId)
    .in("name", NAMES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { phase: "absent" };
  if (data.name === "strategy.failed") {
    const reason = (data.payload as { reason?: unknown } | null)?.reason;
    return {
      phase: "failed",
      reason: typeof reason === "string" && reason.trim() ? reason : "No reason was recorded.",
      at: data.created_at,
    };
  }
  if (data.name === "strategy.queued") return { phase: "running", since: data.created_at };
  return { phase: "ready" };
}

/**
 * How long the agent has been at it, in words. Reading the site and writing
 * four customer profiles takes minutes, so "a few seconds ago" and "eleven
 * minutes ago" mean quite different things about whether to worry.
 */
export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/**
 * Has this person done their part of onboarding?
 *
 * Not "has the agent finished", which is what the checklist used to ask. The
 * form is the person's part; the business profile is the agent's, and it lands
 * minutes later — or never, if the run fails. Asking the wrong one of those two
 * questions is what put a Start button in front of a tester who had just
 * pressed Start, for twenty-one minutes.
 *
 * A failed run counts as done here on purpose: they did tell us. What they need
 * is the banner saying the agent broke and a way to retry, not a checklist row
 * implying they left a form blank.
 */
export function hasToldUsWhatTheySell(strategy: StrategyState): boolean {
  return strategy.phase !== "absent";
}
