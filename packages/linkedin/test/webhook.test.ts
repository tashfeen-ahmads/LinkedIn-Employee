import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";

const SECRET = "webhook-secret";

/**
 * The form Unipile actually sends: the timestamp and the body signed together,
 * presented as `t=<unix>,v0=<hex>`.
 */
function sign(body: string, timestamp = 1_710_662_400): string {
  const v0 = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v0=${v0}`;
}

/** The older form: the body alone, still accepted. */
function signBodyOnly(body: string): string {
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

  it("accepts the body-only form too, so an older sender keeps verifying", () => {
    expect(provider().parseWebhook({ body: payload, signature: signBodyOnly(payload) })).toHaveLength(1);
  });

  it("will not verify a timestamped delivery against the body alone", () => {
    // The bug this replaced: signing `body` where Unipile signs
    // `${t}.${body}`. Every real delivery was rejected, and because the gate
    // fails closed the symptom was silence — no inbound reply ever arrived.
    const wrong = `t=1710662400,v0=${signBodyOnly(payload)}`;
    expect(() => provider().parseWebhook({ body: payload, signature: wrong })).toThrow(/signature/i);
  });

  it("rejects a delivery whose timestamp was moved after signing", () => {
    // `t` is inside the signed payload, so changing it invalidates the whole
    // signature rather than merely being ignored.
    const signature = sign(payload).replace("t=1710662400", "t=1710662999");
    expect(() => provider().parseWebhook({ body: payload, signature })).toThrow(/signature/i);
  });

  it("accepts a retry sent long after its timestamp", () => {
    // Unipile retries a delivery the endpoint rejected. A freshness window
    // would reject those retries permanently, which is the failure this whole
    // file exists to prevent.
    const ancient = sign(payload, 1_000_000_000);
    expect(provider().parseWebhook({ body: payload, signature: ancient })).toHaveLength(1);
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
