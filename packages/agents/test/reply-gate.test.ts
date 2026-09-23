import { describe, expect, it } from "vitest";
import { RulesOfEngagementSchema, type ReplyClassification } from "@le/shared";
import { applyRules, containsOptOut } from "../src/reply.js";

const autopilot = RulesOfEngagementSchema.parse({ mode: "autopilot" });
const approval = RulesOfEngagementSchema.parse({ mode: "approval" });

function classification(overrides: Partial<ReplyClassification> = {}): ReplyClassification {
  return {
    intent: "interested",
    sentiment: "positive",
    needsHuman: false,
    needsHumanReason: null,
    referralName: null,
    followUpAfterDays: null,
    mentionsPricing: false,
    mentionsLegalOrCompliance: false,
    asksForHuman: false,
    optOut: false,
    confidence: 0.95,
    ...overrides,
  };
}

describe("applyRules", () => {
  it("sends a clean, confident, positive reply on autopilot", () => {
    expect(applyRules(classification(), autopilot)).toEqual({ action: "send" });
  });

  it("holds everything in approval mode, even a perfect message", () => {
    expect(applyRules(classification(), approval).action).toBe("hold_for_human");
  });

  it("stops the sequence on an opt-out regardless of mode", () => {
    for (const rules of [autopilot, approval]) {
      expect(applyRules(classification({ optOut: true }), rules).action).toBe("stop_sequence");
    }
  });

  it("an opt-out outranks every other signal", () => {
    const decision = applyRules(
      classification({ optOut: true, intent: "interested", sentiment: "positive", confidence: 1 }),
      autopilot,
    );
    expect(decision.action).toBe("stop_sequence");
  });

  it("hands off pricing, legal, and requests for a human", () => {
    expect(applyRules(classification({ mentionsPricing: true }), autopilot).action).toBe("hold_for_human");
    expect(applyRules(classification({ mentionsLegalOrCompliance: true }), autopilot).action).toBe("hold_for_human");
    expect(applyRules(classification({ asksForHuman: true }), autopilot).action).toBe("hold_for_human");
  });

  it("hands off negative sentiment rather than arguing", () => {
    expect(applyRules(classification({ sentiment: "negative" }), autopilot).action).toBe("hold_for_human");
  });

  it("hands off when the model is not confident", () => {
    const decision = applyRules(classification({ confidence: 0.4 }), autopilot);
    expect(decision.action).toBe("hold_for_human");
    expect(decision.reason).toContain("confidence");
  });

  it("respects the model's own needsHuman flag before any other rule", () => {
    const decision = applyRules(
      classification({ needsHuman: true, needsHumanReason: "asked about SOC 2" }),
      autopilot,
    );
    expect(decision).toEqual({ action: "hold_for_human", reason: "asked about SOC 2" });
  });

  it("closes the thread when the prospect is not interested", () => {
    expect(applyRules(classification({ intent: "not_interested" }), autopilot).action).toBe("stop_sequence");
  });

  it("honours per-campaign rules that disable a hand-off", () => {
    const lenient = RulesOfEngagementSchema.parse({ mode: "autopilot", handOffOnPricing: false });
    expect(applyRules(classification({ mentionsPricing: true }), lenient)).toEqual({ action: "send" });
  });
});

describe("containsOptOut", () => {
  it("catches the phrases people actually use", () => {
    for (const message of [
      "Not interested, thanks",
      "Please REMOVE ME from your list",
      "unsubscribe",
      "Do not contact me again",
    ]) {
      expect(containsOptOut(message), message).toBe(true);
    }
  });

  it("does not treat a soft no as an opt-out", () => {
    for (const message of ["Not right now, maybe next quarter", "Can you send more info?"]) {
      expect(containsOptOut(message), message).toBe(false);
    }
  });
});

describe("callStructured usage accounting", () => {
  it("records one usage row per call, not two, when the model refuses", async () => {
    const { callStructured, AgentRefusalError } = await import("../src/client.js");
    const { z } = await import("zod");
    const rows: unknown[] = [];

    const ctx = {
      client: {
        provider: "openai",
        models: { writer: "gpt-5", classifier: "gpt-5-mini" },
        complete: async () => ({
          parsed: null,
          refusal: "cyber",
          usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0 },
        }),
      },
      onUsage: (usage: unknown) => {
        rows.push(usage);
      },
    } as never;

    await expect(
      callStructured(ctx, {
        agent: "test",
        model: "gpt-5-mini",
        promptVersion: "v1",
        schema: z.object({ ok: z.boolean() }),
        system: [{ type: "text" as const, text: "system" }],
        userContent: "hello",
      }),
    ).rejects.toBeInstanceOf(AgentRefusalError);

    // A second, token-less row would double-count every refusal in the cost
    // reporting the llm_calls table exists for.
    expect(rows).toHaveLength(1);
    expect((rows[0] as { inputTokens: number }).inputTokens).toBe(100);
  });

  it("still records a row when the call itself throws", async () => {
    const { callStructured } = await import("../src/client.js");
    const { z } = await import("zod");
    const rows: unknown[] = [];

    const ctx = {
      client: {
        provider: "openai",
        models: { writer: "gpt-5", classifier: "gpt-5-mini" },
        complete: async () => {
          throw new Error("network down");
        },
      },
      onUsage: (usage: unknown) => {
        rows.push(usage);
      },
    } as never;

    await expect(
      callStructured(ctx, {
        agent: "test",
        model: "gpt-5-mini",
        promptVersion: "v1",
        schema: z.object({ ok: z.boolean() }),
        system: [{ type: "text" as const, text: "system" }],
        userContent: "hello",
      }),
    ).rejects.toThrow("network down");

    expect(rows).toHaveLength(1);
    expect((rows[0] as { error?: string }).error).toContain("network down");
  });
});

describe("an autonomous workspace", () => {
  /*
   * The funnel was reading 0% because a hold is not a pause, it is a full
   * stop. A prospect who replies "how much is it?" on a Friday and is never
   * answered is a warm lead lost, and no screen explains why.
   */
  const autonomous = RulesOfEngagementSchema.parse({ mode: "autopilot", autonomy: "autonomous" });

  it("answers a pricing question instead of waiting for somebody", () => {
    const decision = applyRules(
      classification({ mentionsPricing: true, needsHuman: true, needsHumanReason: "pricing" }),
      autonomous,
    );
    expect(decision.action).toBe("send");
  });

  it("answers a legal question, and a negative one", () => {
    expect(
      applyRules(classification({ mentionsLegalOrCompliance: true, needsHuman: true }), autonomous).action,
    ).toBe("send");
    expect(applyRules(classification({ sentiment: "negative", needsHuman: true }), autonomous).action).toBe(
      "send",
    );
  });

  it("still stops dead on an opt-out", () => {
    // Rule 7. Autonomy is about finishing work, never about who may be written
    // to after they have asked not to be.
    expect(applyRules(classification({ optOut: true }), autonomous).action).toBe("stop_sequence");
  });

  it("still hands over when the prospect asks for a person", () => {
    /*
     * The one hold that is about the prospect's wishes rather than our
     * confidence. Answering "can I talk to a human?" with another
     * machine-written message is a promise broken under a real rep's name.
     */
    expect(applyRules(classification({ asksForHuman: true }), autonomous).action).toBe("hold_for_human");
  });

  it("still holds a message it did not understand", () => {
    // Autonomy means finishing the work, not guessing at it: a reply written
    // from a misread message reaches a real person just as fast as a good one.
    expect(applyRules(classification({ confidence: 0.4 }), autonomous).action).toBe("hold_for_human");
  });

  it("changes nothing for a workspace that did not ask for it", () => {
    // The guard on the guard: if supervised behaved like autonomous, the
    // setting would be doing nothing and every test above would be vacuous.
    const decision = applyRules(
      classification({ mentionsPricing: true, needsHuman: true }),
      RulesOfEngagementSchema.parse({ mode: "autopilot", autonomy: "supervised" }),
    );
    expect(decision.action).toBe("hold_for_human");
  });
});
