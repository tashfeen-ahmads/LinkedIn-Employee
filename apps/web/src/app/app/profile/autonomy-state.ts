/**
 * Who answers a reply: the workspace's own answer first, and what its
 * campaigns say only when it has none.
 *
 * The campaigns used to be the only source, on the reasoning that they are
 * where the agent reads it — true of a campaign already running, and false of
 * the next one, which the Targeting Agent builds from the workspace's answer.
 * It also read "supervised" on a brand new workspace that had chosen
 * "autonomous" during onboarding, because there were no campaigns yet to ask.
 * Saving writes both (`setAutonomy`), so the two cannot drift; a workspace from
 * before that still falls back to its campaigns rather than to a guess.
 *
 * One reading, used by the Replies section and by the menu's hint beside it:
 * two readings of one setting drift, and the screen's is the one somebody
 * believes.
 */
export type Autonomy = "autonomous" | "supervised";

export function readAutonomy(
  onboarding: unknown,
  ruleRows: ReadonlyArray<{ rules: unknown }> | null | undefined,
): Autonomy {
  const stated = (onboarding as { autonomy?: string } | null)?.autonomy;
  return stated === "autonomous" || stated === "supervised"
    ? stated
    : (ruleRows ?? []).some((row) => (row.rules as { autonomy?: string } | null)?.autonomy === "autonomous")
      ? "autonomous"
      : "supervised";
}
