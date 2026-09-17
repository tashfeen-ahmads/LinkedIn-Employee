import type { Db } from "@le/db";

/**
 * Says, in the database, that something happened here.
 *
 * Deliberately the plainest write in the worker. Everything else that reports
 * on this deployment's health travels through the queue, the provider or a
 * model — so when one of those is what is broken, none of it arrives, and the
 * product falls back to being examined through a log viewer that whoever is
 * stuck usually cannot open. An hour went that way. This goes to Postgres,
 * which the screens already read.
 */
export async function recordBeat(
  db: Db,
  name: string,
  detail: Record<string, unknown>,
  at: Date = new Date(),
): Promise<void> {
  const { error } = await db
    .from("worker_heartbeats")
    // One row per name, upserted. A log would grow without bound to answer a
    // question that only ever concerns the most recent run.
    .upsert({ name, beat_at: at.toISOString(), detail: detail as never }, { onConflict: "name" });

  // Never fatal, in either caller. This is a note about the worker; the worker
  // does not stop sending a customer's messages because the note failed.
  if (error) console.error("could not record a heartbeat", { name, reason: error.message });
}
