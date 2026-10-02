import { createHash } from "node:crypto";
import type { Db } from "@le/db";
import type { LinkedInProvider } from "@le/linkedin";
import { recordBeat } from "./heartbeat.js";

export const WEBHOOKS_BEAT = "webhooks:registered";

/**
 * Make sure the provider calls this deployment with the secret it checks.
 *
 * Every prospect reply was refused for days because the webhook had been set
 * up in the provider's dashboard without the header that proves a delivery is
 * genuine. Failing closed was right (rule 8); depending on a person to find a
 * settings page was not. So the worker registers its own webhooks at boot.
 *
 * Done once per secret and address: the registration is recorded with a
 * fingerprint of both, and a boot that finds the same fingerprint does
 * nothing. Rotating the secret, or moving the worker, registers again. The
 * secret itself is never written down.
 */
export async function ensureWebhooks(
  db: Db,
  linkedin: LinkedInProvider,
  input: { workerUrl: string; secret: string | undefined },
): Promise<"registered" | "unchanged" | "unsupported" | "no-secret"> {
  if (!linkedin.ensureWebhooks) return "unsupported";
  if (!input.secret) return "no-secret";

  const endpoints = [
    { source: "messaging" as const, url: `${input.workerUrl}/webhooks/unipile/messages`, name: "nora-messages" },
    { source: "account_status" as const, url: `${input.workerUrl}/webhooks/unipile/accounts`, name: "nora-accounts" },
  ];
  const fingerprint = createHash("sha256")
    .update(`${input.secret}|${endpoints.map((e) => e.url).join("|")}`)
    .digest("hex")
    .slice(0, 16);

  const { data: last } = await db.from("worker_heartbeats").select("detail").eq("name", WEBHOOKS_BEAT).maybeSingle();
  const previous = (last?.detail ?? null) as { ok?: boolean; fingerprint?: string } | null;
  if (previous?.ok && previous.fingerprint === fingerprint) return "unchanged";

  try {
    const { created, removed } = await linkedin.ensureWebhooks({ secret: input.secret, endpoints });
    await recordBeat(db, WEBHOOKS_BEAT, { at: new Date().toISOString(), ok: true, fingerprint, created, removed });
    return "registered";
  } catch (err) {
    await recordBeat(db, WEBHOOKS_BEAT, {
      at: new Date().toISOString(),
      ok: false,
      fingerprint,
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
