import type { Db } from "@le/db";
import { decryptJson, encryptJson } from "./crypto.js";

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Decrypts a stored credential, refreshes it if it has expired, and writes the
 * new one back.
 *
 * This sequence was copy-pasted once per provider across the calendar and CRM
 * resolvers. The copies had already drifted — one marked a decrypt failure as
 * `error` where the others used `reauth_required` — which is what duplicated
 * lifecycle code does. Returning null means the caller should behave as though
 * nothing is connected, and the integration has been marked for re-auth.
 */
export async function loadRefreshedCredential<T extends StoredTokens>(
  db: Db,
  input: {
    integrationId: string;
    credentialsEncrypted: string;
    key: string;
    refresh: (tokens: T) => Promise<T>;
  },
): Promise<T | null> {
  let tokens: T;
  try {
    tokens = decryptJson<T>(input.credentialsEncrypted, input.key);
  } catch {
    await markReauth(db, input.integrationId);
    return null;
  }

  if (tokens.expiresAt > Date.now()) return tokens;

  if (!tokens.refreshToken) {
    await markReauth(db, input.integrationId);
    return null;
  }

  try {
    const refreshed = await input.refresh(tokens);
    await db
      .from("integrations")
      .update({ credentials_encrypted: encryptJson(refreshed, input.key) })
      .eq("id", input.integrationId);
    return refreshed;
  } catch {
    await markReauth(db, input.integrationId);
    return null;
  }
}

async function markReauth(db: Db, integrationId: string): Promise<void> {
  await db.from("integrations").update({ status: "reauth_required" }).eq("id", integrationId);
}
