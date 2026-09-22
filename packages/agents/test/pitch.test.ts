import { describe, expect, it } from "vitest";
import { draftReply } from "../src/reply.js";
import { writePitch } from "../src/pitch.js";
import type { AgentContext } from "../src/client.js";
import type { BusinessProfile, ReplyClassification, RulesOfEngagement } from "@le/shared";

/**
 * The offer is the one piece of copy in this product that argues for the thing
 * being sold, and until it was written down the Reply Agent improvised it from
 * the business profile in every conversation. These check that a stored pitch
 * actually reaches the model, and that it reaches it as the offer to make
 * rather than as one more paragraph of background.
 */

/** A context that records what was sent and returns a fixed parse. */
function recordingCtx(parsed: Record<string, unknown>) {
  const sent: Array<{ system: string; user: string; cachedSystem: string }> = [];
  const ctx = {
    workspaceId: "w",
    client: {
      models: { writer: "w", classifier: "c" },
      complete: async (request: {
        system: Array<{ text: string; cached?: boolean }>;
        user: string;
      }) => {
        sent.push({
          system: request.system.map((s) => s.text).join("\n"),
          cachedSystem: request.system
            .filter((s) => s.cached)
            .map((s) => s.text)
            .join("\n"),
          user: request.user,
        });
        return {
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
          refusal: null,
          incomplete: null,
          parsed,
        };
      },
    },
    recordCall: async () => {},
  } as unknown as AgentContext;
  return { ctx, sent };
}

const business: BusinessProfile = {
  companyName: "Acme",
  oneLiner: "We do a thing.",
  offering: "A thing.",
  differentiators: [],
  proofPoints: [],
  competitors: [],
  pricingModel: "unknown",
  toneOfVoice: "plain",
  commonObjections: [],
};

const classification: ReplyClassification = {
  intent: "interested",
  sentiment: "positive",
  confidence: 0.9,
  optOut: false,
  needsHuman: false,
  needsHumanReason: null,
  mentionsPricing: false,
  mentionsLegalOrCompliance: false,
  asksForHuman: false,
  followUpAfterDays: null,
};

const rules: RulesOfEngagement = {
  mode: "autopilot",
  goal: "book a meeting",
  handOffOnPricing: true,
  handOffOnLegal: true,
  handOffOnHumanRequest: true,
  handOffOnNegative: true,
  minConfidence: 0.75,
  workingHours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
  bookingLink: undefined,
};

const draft = {
  message: "Sure — here is what we do.",
  proposedSlots: [],
  unansweredQuestions: [],
  confidence: 0.9,
  needsHuman: false,
};

const PITCH = "Most referrals never get followed up. We match you with partners and make the intro.";

describe("the pitch reaches the writer", () => {
  it("hands the approved pitch to the model as the offer to make", async () => {
    const { ctx, sent } = recordingCtx(draft);
    await draftReply(ctx, {
      business,
      repName: "Rep",
      knowledge: [],
      history: [],
      message: "what is this?",
      classification,
      rules,
      pitch: PITCH,
      availableSlots: [],
    });

    expect(sent[0]!.system).toContain(PITCH);
    // Not merely present: named as the offer, or the model reads it as one more
    // paragraph of background and writes its own pitch underneath it.
    expect(sent[0]!.system).toMatch(/make THIS offer/i);
    expect(sent[0]!.system).toMatch(/never invent a different offer/i);
  });

  it("caches the pitch, because it is the same in every conversation", async () => {
    // It is identical for every prospect in the workspace, so it belongs on the
    // stable side of the cache breakpoint. Below it, every reply in a campaign
    // pays for it again.
    const { ctx, sent } = recordingCtx(draft);
    await draftReply(ctx, {
      business,
      repName: "Rep",
      knowledge: [],
      history: [],
      message: "what is this?",
      classification,
      rules,
      pitch: PITCH,
      availableSlots: [],
    });
    expect(sent[0]!.cachedSystem).toContain(PITCH);
  });

  it("says nothing about a pitch when none is approved", async () => {
    // The instruction must not be there with nothing behind it: "make THIS
    // offer" with no offer is the model inventing one and believing it was
    // told to.
    const { ctx, sent } = recordingCtx(draft);
    await draftReply(ctx, {
      business,
      repName: "Rep",
      knowledge: [],
      history: [],
      message: "what is this?",
      classification,
      rules,
      availableSlots: [],
    });
    expect(sent[0]!.system).not.toMatch(/THE PITCH/);
    expect(sent[0]!.system).not.toMatch(/make THIS offer/i);
  });

  it("tells a conversation campaign to pitch rather than to send a link it has not got", async () => {
    // Rule 30: a campaign asking only for a reply is handed no link at all. The
    // old instruction said "send the link now" regardless, which is how a model
    // comes to write acme.com/demo.
    const { ctx, sent } = recordingCtx(draft);
    await draftReply(ctx, {
      business,
      repName: "Rep",
      knowledge: [],
      history: [],
      message: "sure, what is it?",
      classification,
      rules,
      goal: "reply",
      pitch: PITCH,
      availableSlots: [],
    });
    expect(sent[0]!.system).toMatch(/Make the pitch now/i);
    expect(sent[0]!.system).not.toMatch(/Send the link now/i);
  });
});

describe("writing the pitch", () => {
  it("refuses to put a link in it, and says why in the prompt", async () => {
    const { ctx, sent } = recordingCtx({ body: "x", factsUsed: [] });
    await writePitch(ctx, { business, knowledge: [] });
    // The destination is per campaign and substituted at send time. A URL baked
    // into the pitch is the same wrong address in every conversation.
    expect(sent[0]!.system).toMatch(/No links of any kind/i);
    expect(sent[0]!.system).toMatch(/substituted\s+at send time/i);
  });

  it("shows the model the pitch it is rewriting", async () => {
    // Without it, "make it shorter" returns a different pitch that happens to
    // be short, and the sentence somebody actually liked is gone.
    const { ctx, sent } = recordingCtx({ body: "x", factsUsed: [] });
    await writePitch(ctx, {
      business,
      knowledge: [],
      current: PITCH,
      instruction: "shorter",
    });
    expect(sent[0]!.user).toContain(PITCH);
    expect(sent[0]!.user).toContain("shorter");
  });

  it("does not claim a fact the knowledge base does not hold", async () => {
    // The knowledge renderer is what makes this checkable: an empty base says
    // so in as many words rather than leaving the model to fill the silence.
    const { ctx, sent } = recordingCtx({ body: "x", factsUsed: [] });
    await writePitch(ctx, { business, knowledge: [] });
    expect(sent[0]!.user).toMatch(/you may not state any product fact/i);
  });
});
