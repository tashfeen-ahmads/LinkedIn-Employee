import type { Db } from "@le/db";

/**
 * Which steps make up one prospect's sequence. Rule 28.
 *
 * An angle that wrote a sequence owns it end to end: falling through to the
 * campaign's step 2 because this angle only wrote one would send that group an
 * opener in one voice and a follow-up in another, and the results would no
 * longer be measuring a single thing. The end of the angle's sequence is the
 * end.
 *
 * One definition, because three things ask the question and they used to ask
 * it three ways. The send path treated the angle's sequence as final; the
 * repair loop fell through to a campaign-wide step the angle never had, and so
 * re-armed people whose sequence was over (rule 42: it never invents a step);
 * and the nightly close counted every step of every angle at once, so on a
 * campaign with angles nobody's sequence was ever "completed". Three readings
 * of one rule drift, and each drift here reaches a real person.
 */
export function ownSequence<T extends { variant_id?: string | null }>(
  steps: readonly T[],
  variantId: string | null | undefined,
): T[] {
  if (variantId) {
    const own = steps.filter((step) => step.variant_id === variantId);
    if (own.length) return own;
    // No sequence of its own: an angle stored without one, which the schema
    // does not produce but a partial write could. The campaign's is better
    // than silence.
  }
  // Loosely null: a row written before angles existed has no `variant_id` at
  // all, and it is campaign-wide by definition.
  return steps.filter((step) => step.variant_id == null);
}

/** Every step of one campaign, read once and resolved in memory. */
export async function campaignSteps(
  db: Db,
  campaignId: string,
): Promise<Array<{ variant_id: string | null; step_number: number; message: string; delay_days: number }>> {
  const { data } = await db
    .from("campaign_steps")
    .select("variant_id, step_number, message, delay_days")
    .eq("campaign_id", campaignId);
  return (data ?? []) as Array<{ variant_id: string | null; step_number: number; message: string; delay_days: number }>;
}

/**
 * The message for one step of one prospect's sequence, or null when their
 * sequence has no such step — which is an answer, not a gap to fill.
 */
export async function stepFor(
  db: Db,
  campaignId: string,
  variantId: string | null,
  stepNumber: number,
): Promise<{ message: string; delay_days: number } | null> {
  const steps = ownSequence(await campaignSteps(db, campaignId), variantId);
  return steps.find((step) => step.step_number === stepNumber) ?? null;
}
