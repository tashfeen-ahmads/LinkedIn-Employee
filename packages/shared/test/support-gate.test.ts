import { describe, expect, it } from "vitest";
import { mentionsInternals, supportGate, type SupportDraft } from "../src/support.js";

/**
 * When the support assistant may answer a customer by itself.
 *
 * A held answer costs an operator a minute — it is prefilled in their reply
 * box. A wrong answer sent costs a customer. So every doubt holds.
 */
const good: SupportDraft = {
  category: "how_to",
  answer:
    "Open the Strategy page and press Approve on the profile you want to go after. The search starts by itself, and the campaign appears on the Campaigns page.",
  confidence: 0.9,
  needsHuman: false,
  reasonForHuman: null,
};
const base = { autopilot: true, reopened: false, ageMs: 60_000, draft: good };

describe("supportGate", () => {
  it("sends a confident how-to answer", () => {
    expect(supportGate(base)).toEqual({ send: true });
  });

  it("holds everything when autopilot is off", () => {
    expect(supportGate({ ...base, autopilot: false }).send).toBe(false);
  });

  it("gives somebody who said the last answer did not help a person", () => {
    expect(supportGate({ ...base, reopened: true }).send).toBe(false);
  });

  it("lets a person check an answer to a ticket that waited days", () => {
    expect(supportGate({ ...base, ageMs: 3 * 86_400_000 }).send).toBe(false);
  });

  it("holds when the assistant asks for a person, whatever its confidence", () => {
    const verdict = supportGate({ ...base, draft: { ...good, needsHuman: true, reasonForHuman: "They sound upset." } });
    expect(verdict).toEqual({ send: false, reason: "They sound upset." });
  });

  it("always gives bugs, billing and feature requests to a person", () => {
    for (const category of ["bug", "account_and_billing", "feature_request"] as const) {
      expect(supportGate({ ...base, draft: { ...good, category } }).send).toBe(false);
    }
  });

  it("holds an answer the assistant was not sure about", () => {
    expect(supportGate({ ...base, draft: { ...good, confidence: 0.6 } }).send).toBe(false);
    expect(supportGate({ ...base, draft: { ...good, confidence: Number.NaN } }).send).toBe(false);
  });

  it("holds an answer that names our suppliers or our plumbing (rule 54)", () => {
    for (const leak of [
      "Your Unipile account needs reconnecting.",
      "Set UNIPILE_WEBHOOK_SECRET on the worker.",
      "The Redis queue was down for a while.",
      "Check /webhooks/unipile/messages.",
    ]) {
      const verdict = supportGate({ ...base, draft: { ...good, answer: `${good.answer} ${leak}` } });
      expect(verdict.send, leak).toBe(false);
    }
  });

  it("holds an empty or runaway answer", () => {
    expect(supportGate({ ...base, draft: { ...good, answer: "Yes." } }).send).toBe(false);
    expect(supportGate({ ...base, draft: { ...good, answer: "x ".repeat(2000) } }).send).toBe(false);
  });
});

describe("mentionsInternals", () => {
  it("does not flag ordinary English that merely contains a vendor's letters", () => {
    expect(mentionsInternals("The page rendered the environment of your campaign.")).toBeNull();
  });
});

import { standingWebhookRefusal } from "../src/needs-you.js";

describe("standingWebhookRefusal", () => {
  const refused = { detail: { ok: false, hadSignature: false }, beat_at: "2026-10-02T22:16:46Z" };
  it("reports a refusal nobody has repaired", () => {
    expect(standingWebhookRefusal(refused, null)).toBe("no_signature");
  });
  it("stops reporting it once the webhooks were registered again afterwards", () => {
    // The operator console said "deliveries are being refused" for days after
    // the fix, because nothing compared the refusal with the repair.
    expect(standingWebhookRefusal(refused, { detail: { ok: true }, beat_at: "2026-10-05T16:31:27Z" })).toBeNull();
  });
  it("keeps reporting it when the registration is older, or failed", () => {
    expect(standingWebhookRefusal(refused, { detail: { ok: true }, beat_at: "2026-10-01T00:00:00Z" })).toBe("no_signature");
    expect(standingWebhookRefusal(refused, { detail: { ok: false }, beat_at: "2026-10-05T16:31:27Z" })).toBe("no_signature");
  });
});
