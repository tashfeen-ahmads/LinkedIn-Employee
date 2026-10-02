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

/**
 * The same verification on the accounts webhook, which had none of it.
 *
 * Every test above covers `parseWebhook`. `parseAccountWebhook` carries a
 * character-for-character copy of the two guards and was covered by nothing:
 * deleting both — accepting any unsigned body from anyone — broke no test in
 * the repo. It was found by giving it a mutation of its own and watching the
 * mutation survive.
 *
 * And it is the worse of the two to lose. A forged *message* makes the Reply
 * Agent answer something no prospect sent; a forged *account* delivery binds a
 * stranger's LinkedIn account to a rep's row, and every message the campaign
 * sends then leaves that stranger's account (rule 8). The higher stake was the
 * untested one, which is the usual way round: the message parser was debugged
 * live when real replies stopped arriving, so it accumulated tests, and this
 * one has never visibly failed.
 */
describe("Unipile account webhook verification", () => {
  const account = JSON.stringify({
    account_id: "acct_new",
    // The hosted flow sends the rep's user id as `name` and the notify
    // webhook echoes it back there, which is the shape this parser sees.
    name: "8ddd8b8a-ac56-45a6-87b3-b3a4526b4c8e",
    account_name: "Sam Patel",
    status: "OK",
  });

  it("accepts a correctly signed delivery", () => {
    const accounts = provider().parseAccountWebhook({ body: account, signature: sign(account) });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.providerAccountId).toBe("acct_new");
    expect(accounts[0]?.reference).toBe("8ddd8b8a-ac56-45a6-87b3-b3a4526b4c8e");
  });

  it("accepts the body-only form too, so an older sender keeps verifying", () => {
    expect(provider().parseAccountWebhook({ body: account, signature: signBodyOnly(account) })).toHaveLength(1);
  });

  it("rejects an unsigned delivery", () => {
    // What this deployment has actually been receiving: every recorded
    // delivery arrived with no signature header at all.
    expect(() => provider().parseAccountWebhook({ body: account })).toThrow(/signature/i);
  });

  it("rejects a delivery signed with the wrong key", () => {
    const forged = createHmac("sha256", "attacker").update(account).digest("hex");
    expect(() => provider().parseAccountWebhook({ body: account, signature: forged })).toThrow(/signature/i);
  });

  it("rejects a body whose account id was swapped after signing", () => {
    // The attack in one line: a valid signature over one account, replayed
    // with a different id in the body.
    const signature = sign(account);
    const tampered = account.replace("acct_new", "acct_attacker");
    expect(() => provider().parseAccountWebhook({ body: tampered, signature })).toThrow(/signature/i);
  });

  it("rejects a delivery whose timestamp was moved after signing", () => {
    const signature = sign(account).replace("t=1710662400", "t=1710662999");
    expect(() => provider().parseAccountWebhook({ body: account, signature })).toThrow(/signature/i);
  });

  it("fails closed when no secret is configured", () => {
    expect(() =>
      provider({ secret: undefined }).parseAccountWebhook({ body: account, signature: sign(account) }),
    ).toThrow(/not configured/i);
  });

  it("drops an entry that names neither the account nor the rep", () => {
    // Guessing which row a nameless entry meant is how the wrong account gets
    // bound to the wrong person.
    const anonymous = JSON.stringify({ status: "OK" });
    expect(provider().parseAccountWebhook({ body: anonymous, signature: sign(anonymous) })).toHaveLength(0);
  });
});

/**
 * Unipile's v1 webhooks, which authenticate with a header rather than a
 * signature.
 *
 * This deployment uses Unipile's v1 API, and a v1 webhook is never HMAC-signed:
 * it is created with a `headers` array and authenticated by a shared secret in
 * a custom header. The parser accepted only the v2 signature, so every delivery
 * this deployment ever received was refused as unsigned — prospect replies
 * dropped at the door for weeks — and no secret anybody could set in Unipile
 * would have produced the header being waited for.
 *
 * Accepting the header must not open the door any wider than the signature
 * does, so the refusals are tested as carefully as the acceptance.
 */
describe("Unipile v1 webhooks, authenticated by header", () => {
  it("accepts a message delivery carrying the shared secret", () => {
    const messages = provider().parseWebhook({ body: payload, authHeader: SECRET });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain("Sounds good");
  });

  it("accepts an account delivery carrying the shared secret", () => {
    const account = JSON.stringify({ account_id: "acct_new", name: "rep-id", status: "OK" });
    expect(provider().parseAccountWebhook({ body: account, authHeader: SECRET })).toHaveLength(1);
  });

  it("tolerates the trailing newline a pasted secret often carries", () => {
    expect(provider().parseWebhook({ body: payload, authHeader: `${SECRET}\n` })).toHaveLength(1);
  });

  it("rejects the wrong secret", () => {
    expect(() => provider().parseWebhook({ body: payload, authHeader: "not-the-secret" })).toThrow(/signature/i);
  });

  it("rejects a secret that merely starts the same way", () => {
    // A prefix match would let a caller recover the secret a character at a time.
    expect(() => provider().parseWebhook({ body: payload, authHeader: SECRET.slice(0, -1) })).toThrow(/signature/i);
    expect(() => provider().parseWebhook({ body: payload, authHeader: `${SECRET}x` })).toThrow(/signature/i);
  });

  it("rejects a forged account delivery carrying the wrong secret", () => {
    // The dangerous one: a forged account delivery binds a stranger's LinkedIn
    // to a rep's row (rule 8).
    const forged = JSON.stringify({ account_id: "acct_attacker", name: "rep-id", status: "OK" });
    expect(() => provider().parseAccountWebhook({ body: forged, authHeader: "guess" })).toThrow(/signature/i);
  });

  it("still fails closed with no secret configured, header or not", () => {
    // An empty configured secret must not be "matched" by an empty header.
    expect(() => provider({ secret: undefined }).parseWebhook({ body: payload, authHeader: "" })).toThrow(
      /not configured/i,
    );
    expect(() => provider({ secret: undefined }).parseWebhook({ body: payload, authHeader: SECRET })).toThrow(
      /not configured/i,
    );
  });

  it("rejects an empty header rather than reading it as a match", () => {
    expect(() => provider().parseWebhook({ body: payload, authHeader: "" })).toThrow(/signature/i);
  });

  it("still rejects a delivery carrying neither credential", () => {
    expect(() => provider().parseWebhook({ body: payload })).toThrow(/signature/i);
  });
});
