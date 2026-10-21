import type { ConnectedAccount } from "@le/linkedin";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { recordBeat } from "../heartbeat.js";

export const DUPLICATE_RELEASE_BEAT = "accounts:duplicates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hands back a second provider account for somebody who already has a working
 * one here.
 *
 * Finishing the LinkedIn sign-in twice makes the provider create a second
 * account. This product keeps using the first and never touches the second,
 * and the provider bills both every month: Phil Whitebloom's two accounts,
 * both "Running" on the same day, were exactly that. Nothing removed the
 * spare, because nothing here holds it.
 *
 * Only an exact duplicate is removed. The spare must be held by no row here,
 * and must carry the same person's label as an account a row does hold, and
 * that held account must be healthy at the provider. So the account somebody
 * actually sends from is never the one released, and an account connected for
 * somebody new is never mistaken for a spare. A provider that could not be
 * asked releases nothing (rule 17).
 */
export async function releaseDuplicateAccounts(ctx: WorkerContext): Promise<{ released: number; failed: number }> {
  const { db } = ctx;
  let accounts: ConnectedAccount[];
  try {
    accounts = await ctx.linkedin.listAccounts();
  } catch (err) {
    console.error("could not list provider accounts for duplicates", err);
    return { released: 0, failed: 0 };
  }

  const { data: rows, error } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, user_id, provider_account_id")
    .not("provider_account_id", "is", null);
  if (error) return { released: 0, failed: 0 };
  const heldBy = new Map((rows ?? []).map((r) => [r.provider_account_id as string, r]));

  // Somebody part-way through connecting has an account at the provider that
  // no row holds yet, for a minute. Never theirs to lose: anyone with a row
  // waiting on a sign-in is left alone until it settles.
  const { data: waiting, error: waitingError } = await db
    .from("linkedin_accounts")
    .select("user_id")
    .in("status", ["connecting", "reauth_required"]);
  if (waitingError) return { released: 0, failed: 0 };
  const connecting = new Set((waiting ?? []).map((r) => r.user_id as string));

  const label = (a: ConnectedAccount) => (a.displayName || a.reference || "").trim().toLowerCase();
  const healthyHeld = accounts.filter((a) => heldBy.has(a.providerAccountId) && a.status === "ok");

  let released = 0;
  let failed = 0;
  const done: Array<{ released: string; kept: string }> = [];
  for (const spare of accounts) {
    if (heldBy.has(spare.providerAccountId)) continue;
    const name = label(spare);
    const twin = healthyHeld.find((held) => {
      const owner = heldBy.get(held.providerAccountId);
      // The hosted flow labels an account with the rep's user id. A spare
      // labelled with somebody's id is that person's, and only that person's
      // twin; two different people who share a name are never each other's.
      if (UUID.test(spare.reference)) return spare.reference === owner?.user_id;
      return (spare.reference && spare.reference === held.reference) || (name.length > 0 && name === label(held));
    });
    if (!twin) continue;
    const owner = heldBy.get(twin.providerAccountId);
    if (!owner || connecting.has(owner.user_id as string)) continue;

    // Asked again immediately before: a claim that landed since the read above
    // means somebody is using it now.
    const { data: claimed } = await db
      .from("linkedin_accounts")
      .select("id")
      .eq("provider_account_id", spare.providerAccountId)
      .limit(1);
    if (claimed?.length) continue;

    const result = await ctx.linkedin.deleteAccount(spare.providerAccountId);
    if (!result.ok) {
      failed += 1;
      console.error("could not release a duplicate provider account", {
        account: spare.providerAccountId,
        reason: result.error ?? "refused",
      });
      continue;
    }
    released += 1;
    done.push({ released: spare.providerAccountId, kept: twin.providerAccountId });
    {
      await recordEvent(db, {
        workspaceId: owner.workspace_id as string,
        name: "linkedin.account.duplicate_released",
        subjectType: "linkedin_account",
        subjectId: owner.id as string,
        payload: { released: spare.providerAccountId, kept: twin.providerAccountId },
      }).catch(() => undefined);
    }
  }
  await recordBeat(db, DUPLICATE_RELEASE_BEAT, { at: new Date().toISOString(), released, failed, done }).catch(
    () => undefined,
  );
  return { released, failed };
}
