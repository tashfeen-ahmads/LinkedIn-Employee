import { describe, expect, it } from "vitest";
import { z } from "zod";
import { estimateCostUsd } from "@le/shared";
import { OpenAiClient, createLlmClient } from "../src/llm.js";

/**
 * The provider seam.
 *
 * These are about arithmetic and selection, not about the model: nothing here
 * makes a network call. What they guard is the pair of mistakes that are
 * invisible when they happen — a cost report that is wrong in the flattering
 * direction, and a deployment that picks the provider whose key it does not
 * have.
 */

function fakeOpenAi(usage: Record<string, unknown>, output: unknown[] = []) {
  const client = new OpenAiClient({ apiKey: "sk-test" });
  // The SDK is replaced wholesale: this is about what we do with the numbers
  // it returns, and a real call would prove nothing about that.
  (client as unknown as { client: unknown }).client = {
    responses: {
      parse: async () => ({ output_parsed: { ok: true }, output, usage }),
    },
  };
  return client;
}

describe("OpenAiClient usage accounting", () => {
  it("does not count a cached token twice", async () => {
    // OpenAI reports cached tokens as a subset of input_tokens. Anthropic
    // reports them separately, and estimateCostUsd expects the second shape.
    // Passing OpenAI's numbers through unchanged bills every cached token at
    // the full input rate AND again at the cache rate.
    const client = fakeOpenAi({
      input_tokens: 10_000,
      output_tokens: 500,
      input_tokens_details: { cached_tokens: 8_000 },
    });

    const response = await client.complete({
      model: "gpt-5",
      maxTokens: 100,
      system: [{ text: "stable", cached: true }],
      user: "hello",
      schema: z.object({ ok: z.boolean() }),
    });

    expect(response.usage.inputTokens).toBe(2_000);
    expect(response.usage.cacheReadTokens).toBe(8_000);

    // 2000 fresh + 8000 cached + 500 out, at gpt-5's published rates.
    const cost = estimateCostUsd({ model: "gpt-5", ...response.usage });
    expect(cost).toBeCloseTo((2_000 * 1.25 + 8_000 * 0.125 + 500 * 10) / 1_000_000, 10);
  });

  it("reports a call with no cache hit as entirely fresh input", async () => {
    const client = fakeOpenAi({ input_tokens: 900, output_tokens: 100 });

    const response = await client.complete({
      model: "gpt-5-mini",
      maxTokens: 100,
      system: [{ text: "s" }],
      user: "u",
      schema: z.object({ ok: z.boolean() }),
    });

    expect(response.usage.inputTokens).toBe(900);
    expect(response.usage.cacheReadTokens).toBe(0);
  });

  it("surfaces a refusal, which OpenAI returns as content rather than a status", async () => {
    const client = fakeOpenAi(
      { input_tokens: 10, output_tokens: 0 },
      [{ content: [{ type: "refusal", refusal: "declined" }] }],
    );

    const response = await client.complete({
      model: "gpt-5",
      maxTokens: 100,
      system: [{ text: "s" }],
      user: "u",
      schema: z.object({ ok: z.boolean() }),
    });

    // Read as a normal answer, a refusal reaches a prospect as prose about
    // being unable to help.
    expect(response.refusal).toBe("declined");
  });
});

describe("createLlmClient", () => {
  it("uses whichever key is present, so one paste configures a deployment", () => {
    expect(createLlmClient({ OPENAI_API_KEY: "sk-test" }).provider).toBe("openai");
    expect(createLlmClient({ ANTHROPIC_API_KEY: "sk-ant" }).provider).toBe("anthropic");
  });

  it("lets an explicit provider settle it when both keys exist", () => {
    const env = { OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-ant" };
    expect(createLlmClient({ ...env, LLM_PROVIDER: "anthropic" as const }).provider).toBe("anthropic");
  });

  it("refuses a provider whose key is missing rather than falling back to the other", () => {
    // Falling back would run a campaign on a model nobody chose, at a price
    // nobody agreed, and the only sign would be the model column in llm_calls.
    expect(() => createLlmClient({ LLM_PROVIDER: "openai", ANTHROPIC_API_KEY: "sk-ant" })).toThrow(
      /OPENAI_API_KEY/,
    );
    expect(() => createLlmClient({})).toThrow(/OPENAI_API_KEY or ANTHROPIC_API_KEY/);
  });

  it("names the models each provider actually calls", () => {
    expect(createLlmClient({ OPENAI_API_KEY: "sk-test" }).models.writer).toBe("gpt-5");
    expect(createLlmClient({ ANTHROPIC_API_KEY: "sk-ant" }).models.classifier).toBe("claude-haiku-4-5");
  });
});
