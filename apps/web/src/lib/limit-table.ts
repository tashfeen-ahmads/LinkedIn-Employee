import { LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import type { CapTable } from "./limit-plan";

/**
 * `dailyInviteCap` called once per day of the warm-up, for the limit
 * calculator. Server-side only: @le/linkedin carries code the browser cannot
 * load, so the page builds this table and hands the numbers to the client.
 *
 * Index d is the allowance d whole days after the first send; the last entry
 * is the first day at the full allowance, and every later day reads it.
 */
export function buildCapTable(): { caps: CapTable; neverSentCap: number } {
  const reference = new Date("2026-01-01T12:00:00Z");
  const caps = Array.from({ length: LINKEDIN_LIMITS.warmupDays + 1 }, (_, d) =>
    dailyInviteCap(new Date(reference.getTime() - d * 86_400_000), reference),
  );
  return { caps, neverSentCap: dailyInviteCap(null, reference) };
}
