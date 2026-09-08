import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

/**
 * OAuth tokens are encrypted before they touch Postgres, so a database dump
 * does not hand over access to customers' calendars and CRMs. The key lives in
 * the host's secret manager, never in the database.
 */
export function encryptJson(value: unknown, keyHex: string): string {
  const key = toKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptJson<T>(payload: string, keyHex: string): T {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("malformed ciphertext");

  const decipher = createDecipheriv(ALGORITHM, toKey(keyHex), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function toKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes of hex (64 characters)");
  return key;
}
