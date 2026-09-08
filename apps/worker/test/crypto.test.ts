import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../src/crypto.js";

const KEY = "a".repeat(64);

describe("credential encryption", () => {
  it("round-trips a token payload", () => {
    const tokens = { accessToken: "ya29.test", refreshToken: "1//refresh", expiresAt: 1_800_000_000_000 };
    expect(decryptJson(encryptJson(tokens, KEY), KEY)).toEqual(tokens);
  });

  it("produces different ciphertext each time, so records cannot be correlated", () => {
    const value = { accessToken: "same" };
    expect(encryptJson(value, KEY)).not.toBe(encryptJson(value, KEY));
  });

  it("refuses to decrypt with the wrong key", () => {
    const payload = encryptJson({ accessToken: "secret" }, KEY);
    expect(() => decryptJson(payload, "b".repeat(64))).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const payload = encryptJson({ accessToken: "secret" }, KEY);
    const [iv, tag, data] = payload.split(".");
    const flipped = `${iv}.${tag}.${data!.slice(0, -2)}AA`;
    expect(() => decryptJson(flipped, KEY)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptJson({}, "tooshort")).toThrow(/32 bytes/);
  });
});
