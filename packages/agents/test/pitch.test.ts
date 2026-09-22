import { describe, expect, it } from "vitest";
import { draftReply } from "../src/reply.js";
import { writePitch } from "../src/pitch.js";
import { writeHooks } from "../src/hook.js";
import type { AgentContext } from "../src/client.js";
import {
  HOOK_MAX_CHARS,
  HOOK_VARIANTS_MAX,
  HOOK_VARIANTS_MIN,
  PITCH_MAX_CHARS,
  PITCH_VARIANTS_MAX,
  PITCH_VARIANTS_MIN,
  INVITE_NOTE_MAX_CHARS,
  type BusinessProfile,
  type ReplyClassification,
  type RulesOfEngagement,
} from "@le/shared";

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

const SET = {
  variants: [
    { name: "Leakage", body: "Most of your referrals never happen.", angle: "lost referrals", factsUsed: ["x"] },
    { name: "Sheets", body: "Your referral sheet is a week out of date.", angle: "tracking", factsUsed: ["x"] },
    { name: "Warmth", body: "We make the introduction, so it lands warm.", angle: "friction", factsUsed: ["x"] },
    { name: "Free", body: "Premium is free for the first 1,000 members.", angle: "price", factsUsed: ["x"] },
  ],
};

describe("writing the pitches", () => {
  it("asks for several, because one is an opinion nobody can check", async () => {
    const { ctx, sent } = recordingCtx(SET);
    await writePitch(ctx, { business, knowledge: [] });
    expect(sent[0]!.system).toMatch(new RegExp(`Write ${PITCH_VARIANTS_MIN} to ${PITCH_VARIANTS_MAX}`));
    // Four rewordings test nothing and cost a month to find that out.
    expect(sent[0]!.system).toMatch(/DIFFERENT BET, NOT A REWORDING/i);
  });

  it("states the character limit as a hard number the model must count", async () => {
    /*
     * A pitch is read in a chat window on a phone. The model will happily
     * write 400 characters of excellent prose, and the only place that gets
     * noticed is in front of a prospect.
     */
    const { ctx, sent } = recordingCtx(SET);
    await writePitch(ctx, { business, knowledge: [] });
    expect(sent[0]!.system).toContain(`${PITCH_MAX_CHARS} characters`);
    expect(sent[0]!.system).toMatch(/Count them/i);
  });

  it("drops a line over the limit rather than letting it reach anybody", async () => {
    /*
     * `callStructured` casts its result, it does not parse it, and a provider's
     * structured-output subset enforces the shape of the JSON and not
     * `maxLength` on a string. So the schema is documentation for the model,
     * and this check is the enforcement.
     *
     * The same hole sent a 222-character connection note to LinkedIn and had
     * the invitation refused outright. A long pitch fails more quietly: it is
     * delivered, skimmed, and ignored.
     */
    const tooLong = "x".repeat(PITCH_MAX_CHARS + 1);
    const over = { variants: SET.variants.map((v, i) => (i === 0 ? { ...v, body: tooLong } : v)) };
    const { ctx } = recordingCtx(over);
    const result = await writePitch(ctx, { business, knowledge: [] });
    expect(result.variants).toHaveLength(SET.variants.length - 1);
    expect(result.variants.every((v) => v.body.length <= PITCH_MAX_CHARS)).toBe(true);
  });

  it("refuses outright when every line came back too long", async () => {
    // Nothing safe to offer is a failure the caller has to hear about, not an
    // empty set that reads on screen as "the agent wrote you nothing".
    const tooLong = "x".repeat(PITCH_MAX_CHARS + 1);
    const { ctx } = recordingCtx({ variants: SET.variants.map((v) => ({ ...v, body: tooLong })) });
    await expect(writePitch(ctx, { business, knowledge: [] })).rejects.toThrow(/over 90 characters/);
  });

  it("refuses to put a link in them, and says why in the prompt", async () => {
    // The destination is per campaign and substituted at send time. A URL baked
    // into a pitch is the same wrong address in every conversation for a year.
    const { ctx, sent } = recordingCtx(SET);
    await writePitch(ctx, { business, knowledge: [] });
    expect(sent[0]!.system).toMatch(/no link of any kind/i);
    expect(sent[0]!.system).toMatch(/substituted at send time/i);
  });

  it("hands over the opening angles a person already approved", async () => {
    /*
     * The hooks were written, stored, approved and rendered on /app/strategy
     * since the first week, and nothing ever read one. A pitch written without
     * them is a bet nobody placed: the prospect accepted because of one pain
     * and hears an offer arguing another.
     */
    const { ctx, sent } = recordingCtx(SET);
    await writePitch(ctx, {
      business,
      knowledge: [],
      hooks: ["How does your chapter measure which introductions convert?"],
    });
    expect(sent[0]!.user).toContain("How does your chapter measure which introductions convert?");
  });

  it("shows the model the lines it is rewriting", async () => {
    // Without it, "make them shorter" returns a different set that happens to
    // be short, and the line somebody actually liked is gone.
    const { ctx, sent } = recordingCtx(SET);
    await writePitch(ctx, {
      business,
      knowledge: [],
      current: [PITCH],
      instruction: "shorter",
    });
    expect(sent[0]!.user).toContain(PITCH);
    expect(sent[0]!.user).toContain("shorter");
  });

  it("does not claim a fact the knowledge base does not hold", async () => {
    // The knowledge renderer is what makes this checkable: an empty base says
    // so in as many words rather than leaving the model to fill the silence.
    const { ctx, sent } = recordingCtx(SET);
    await writePitch(ctx, { business, knowledge: [] });
    expect(sent[0]!.user).toMatch(/you may not state any product fact/i);
  });
});


const HOOK_SET = {
  variants: [
    { name: "Measurement", body: "How does your chapter measure which introductions convert?", angle: "proof" },
    { name: "Admin", body: "Is your referral tracking still a spreadsheet?", angle: "friction" },
    { name: "Partners", body: "How do you find partners who actually send you clients?", angle: "supply" },
    { name: "Value", body: "What do members say they get out of the group?", angle: "retention" },
  ],
};

describe("writing the openers", () => {
  it("asks for several, and says they must be different bets", async () => {
    const { ctx, sent } = recordingCtx(HOOK_SET);
    await writeHooks(ctx, { business, profiles: [{ name: "Chapters", summary: "s", pains: ["p"] }] });
    expect(sent[0]!.system).toMatch(new RegExp(`Write ${HOOK_VARIANTS_MIN} to ${HOOK_VARIANTS_MAX}`));
    expect(sent[0]!.system).toMatch(/DIFFERENT BET, NOT A REWORDING/i);
  });

  it("forbids a pitch, a claim and a link in the first thing a stranger reads", async () => {
    /*
     * A connection request is a request to connect. LinkedIn penalises links in
     * invitations and they measurably cut acceptance, and a product claim in a
     * first message reaches a stranger looking like a promise.
     */
    const { ctx, sent } = recordingCtx(HOOK_SET);
    await writeHooks(ctx, { business, profiles: [{ name: "Chapters", summary: "s", pains: ["p"] }] });
    expect(sent[0]!.system).toMatch(/No pitch\./);
    expect(sent[0]!.system).toMatch(/No claim about the product/i);
    expect(sent[0]!.system).toMatch(/No link of any kind/i);
  });

  it("drops an opener over the limit rather than letting it reach anybody", async () => {
    // Same hole as the pitch: `callStructured` casts rather than parses, and a
    // provider's structured-output subset does not enforce `maxLength`.
    const tooLong = "x".repeat(HOOK_MAX_CHARS + 1);
    const over = { variants: HOOK_SET.variants.map((v, i) => (i === 0 ? { ...v, body: tooLong } : v)) };
    const { ctx } = recordingCtx(over);
    const result = await writeHooks(ctx, {
      business,
      profiles: [{ name: "Chapters", summary: "s", pains: ["p"] }],
    });
    expect(result.variants).toHaveLength(HOOK_SET.variants.length - 1);
    expect(result.variants.every((v) => v.body.length <= HOOK_MAX_CHARS)).toBe(true);
  });

  it("leaves room inside the invitation for the person it is addressed to", async () => {
    /*
     * LinkedIn refuses an entire invitation past 200 characters, and rule 16
     * says the note has to say one specific thing about this person. An opener
     * that fills the note leaves nothing for them, which is the template it
     * was meant to replace.
     */
    expect(HOOK_MAX_CHARS).toBeLessThan(INVITE_NOTE_MAX_CHARS);
  });

  it("is written for somebody in particular", async () => {
    // An opener written for nobody is the generic question this replaces.
    const { ctx, sent } = recordingCtx(HOOK_SET);
    await writeHooks(ctx, {
      business,
      profiles: [{ name: "Chapter leaders", summary: "run a BNI chapter", pains: ["no tracking"] }],
    });
    expect(sent[0]!.user).toContain("Chapter leaders");
    expect(sent[0]!.user).toContain("no tracking");
  });
});
