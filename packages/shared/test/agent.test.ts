import { describe, expect, it } from "vitest";
import {
  agentGaps,
  blankAgent,
  isReservedFieldKey,
  isSelectableModel,
  modelProvider,
  modelToUse,
} from "../src/agent.js";

describe("which model a deployment can actually run", () => {
  it("refuses a model nobody can price", () => {
    // A model missing from the price table costs null and never zero, so a
    // deployment could otherwise run on one whose spend no screen reports —
    // and "free" is the wrong answer about cost that nobody investigates.
    expect(isSelectableModel("gpt-5")).toBe(true);
    expect(isSelectableModel("some-model-nobody-prices")).toBe(false);
    expect(isSelectableModel(null)).toBe(false);
  });

  it.each([
    ["gpt-5", "openai"],
    ["gpt-5-mini", "openai"],
    ["claude-opus-5", "anthropic"],
    ["claude-haiku-4-5", "anthropic"],
  ])("knows %s is served by %s", (model, provider) => {
    expect(modelProvider(model)).toBe(provider);
  });

  it("honours the agent's choice when the running provider serves it", () => {
    expect(modelToUse("gpt-5-mini", { provider: "openai", writer: "gpt-5" })).toEqual({
      model: "gpt-5-mini",
      honoured: true,
    });
  });

  it("falls back when the running provider cannot serve the choice", () => {
    /*
     * The failure this exists to prevent. A deployment runs on whichever
     * provider has a key, and a client built for one cannot answer for the
     * other — so an agent set to a Claude model on an OpenAI-keyed deployment
     * is not a slower agent, it is a failed call and a campaign whose notes
     * were never written.
     *
     * Falling back keeps the campaign; `honoured: false` is what stops it
     * being silent, because a setting that quietly does nothing is worse than
     * one that is missing.
     */
    const chosen = modelToUse("claude-opus-5", { provider: "openai", writer: "gpt-5" });

    expect(chosen.model).toBe("gpt-5");
    expect(chosen.honoured).toBe(false);
  });

  it("falls back on a model that is priced by neither provider", () => {
    expect(modelToUse("llama-3", { provider: "openai", writer: "gpt-5" }).honoured).toBe(false);
  });

  it("reports no agent choice as honoured, because there was nothing to honour", () => {
    // Otherwise every campaign with no agent reports a setting we ignored.
    expect(modelToUse(null, { provider: "openai", writer: "gpt-5" })).toEqual({
      model: "gpt-5",
      honoured: true,
    });
  });
});

describe("a new agent", () => {
  it("starts with a voice rather than an empty box", () => {
    // An agent with no voice produces exactly the unanchored copy the rework
    // exists to replace, and a rep handed a blank form has been given the
    // problem rather than a starting point.
    const agent = blankAgent("Tashfeen");

    expect(agent.systemPrompt?.length ?? 0).toBeGreaterThan(0);
    expect(agent.fromName).toBe("Tashfeen");
    expect(isSelectableModel(agent.model)).toBe(true);
  });
});

describe("what an agent still needs", () => {
  const ready = { ...blankAgent("Tashfeen"), name: "Chapters" };

  it("says a model nobody can price is not a model", () => {
    const gaps = agentGaps({ ...ready, model: "not-a-model" }, { approvedOpeners: 1, approvedPitches: 1 });
    expect(gaps.join(" ")).toMatch(/price/);
  });

  it("names an agent with no approved opener", () => {
    const gaps = agentGaps(ready, { approvedOpeners: 0, approvedPitches: 1 });
    expect(gaps.join(" ")).toMatch(/opener/);
  });

  it("is empty for an agent that is ready", () => {
    // Listed rather than returned as a boolean: "not ready" with no reason
    // sends somebody hunting through four sections of a form.
    expect(agentGaps(ready, { approvedOpeners: 1, approvedPitches: 1 })).toEqual([]);
  });
});

describe("custom merge fields", () => {
  it.each(["first_name", "company", "rep_name"])("refuses to redefine %s", (key) => {
    // `renderMerge` would read the built-in and ignore the redefinition — a
    // setting that exists and changes nothing.
    expect(isReservedFieldKey(key)).toBe(true);
  });

  it("allows a name the product does not already fill", () => {
    expect(isReservedFieldKey("chapter_name")).toBe(false);
  });
});
