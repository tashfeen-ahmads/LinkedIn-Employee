import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";

const SECRET = "webhook-secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function provider({ secret }: { secret: string | undefined } = { secret: SECRET }): UnipileProvider {
  return new UnipileProvider({ dsn: "https://api.test", accessToken: "t", webhookSecret: secret });
}

const payload = JSON.stringify({
  message_id: "m1",
  chat_id: "c1",
  account_id: "a1",
  sender_id: "p1",
  text: "Sounds good, send times",
  is_sender: false,
});

describe("Unipile webhook verification", () => {
  it("accepts a correctly signed delivery", () => {
    const messages = provider().parseWebhook({ body: payload, signature: sign(payload) });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain("Sounds good");
  });

  it("rejects an unsigned delivery", () => {
    expect(() => provider().parseWebhook({ body: payload })).toThrow(/signature/i);
  });

  it("rejects a delivery signed with the wrong key", () => {
    const forged = createHmac("sha256", "attacker").update(payload).digest("hex");
    expect(() => provider().parseWebhook({ body: payload, signature: forged })).toThrow(/signature/i);
  });

  it("rejects a body that was altered after signing", () => {
    const signature = sign(payload);
    const tampered = payload.replace("Sounds good", "Send me your bank details");
    expect(() => provider().parseWebhook({ body: tampered, signature })).toThrow(/signature/i);
  });

  it("fails closed when no secret is configured", () => {
    // Accepting unverified deliveries would let anyone make the Reply Agent
    // answer a message no prospect ever sent, in a real rep's name.
    expect(() => provider({ secret: undefined }).parseWebhook({ body: payload, signature: sign(payload) })).toThrow(
      /not configured/i,
    );
  });

  it("ignores messages the rep sent themselves", () => {
    const own = JSON.stringify({ ...JSON.parse(payload), is_sender: true });
    expect(provider().parseWebhook({ body: own, signature: sign(own) })).toHaveLength(0);
  });
});
