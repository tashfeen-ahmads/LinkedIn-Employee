import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callStructured, TruncatedOutputError } from "../src/client.js";
import type { AgentContext } from "../src/client.js";

/**
 * A model that thought until its budget was gone.
 *
 * Reasoning models spend their thinking against the same allowance as their
 * answer, so a high effort setting with a generous-looking maxTokens produces a
 * wholly successful call containing nothing at all. A live campaign died on
 * exactly that: `targeting.campaign: model returned no parsable output`, which
 * reads like a model that ignored its schema and is nothing of the kind.
 *
 * The two need opposite fixes — a bigger budget, or a different prompt — so
 * they are never reported as the same thing.
 */
const Schema = z.object({ ok: z.boolean() });

function ctxReturning(responses: Array<Record<string, unknown>>): {
  ctx: AgentContext;
  calls: Array<{ maxTokens: number; effort?: string }>;
} {
  const calls: Array<{ maxTokens: number; effort?: string }> = [];
  let i = 0;
  const ctx = {
    client: {
      models: { writer: "w", classifier: "c" },
      complete: async (request: { maxTokens: number; effort?: string }) => {
        calls.push({ maxTokens: request.maxTokens, effort: request.effort });
        return {
          usage: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0 },
          refusal: null,
          incomplete: null,
          parsed: null,
          ...responses[i++],
        };
      },
    },
  } as unknown as AgentContext;
  return { ctx, calls };
}

const call = {
  agent: "targeting.campaign",
  model: "w",
  promptVersion: "v1",
  schema: Schema,
  system: [{ text: "s" }],
  userContent: "u",
  effort: "high" as const,
  maxTokens: 8000,
};

describe("a call that ran out of room", () => {
  it("retries with a bigger budget and less thinking", async () => {
    // Doubling the budget alone usually buys more thinking, not an answer.
    const { ctx, calls } = ctxReturning([
      { incomplete: "max_tokens" },
      { parsed: { ok: true } },
    ]);

    expect(await callStructured(ctx, call)).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.maxTokens).toBe(16000);
    expect(calls[1]!.effort).toBe("medium");
  });

  it("gives up with a message that names the real cause", async () => {
    // A fresh context per assertion: the stub hands out its responses in
    // order, so reusing one would test the third and fourth answers rather
    // than the two this case is about.
    await expect(
      callStructured(ctxReturning([{ incomplete: "max_tokens" }, { incomplete: "max_tokens" }]).ctx, call),
    ).rejects.toThrow(TruncatedOutputError);
    await expect(
      callStructured(ctxReturning([{ incomplete: "max_tokens" }, { incomplete: "max_tokens" }]).ctx, call),
    ).rejects.toThrow(/whole token budget/);
  });

  it("does not retry a model that simply ignored its schema", async () => {
    // A different problem with a different fix, and one more expensive call
    // answers nothing about it.
    const { ctx, calls } = ctxReturning([{ parsed: null, incomplete: null }]);

    await expect(callStructured(ctx, call)).rejects.toThrow(/no parsable output/);
    expect(calls).toHaveLength(1);
  });

  it("does not retry a refusal", async () => {
    const { ctx, calls } = ctxReturning([{ refusal: "policy" }]);

    await expect(callStructured(ctx, call)).rejects.toThrow(/declined/);
    expect(calls).toHaveLength(1);
  });

  it("never raises the effort of a call that asked for low", async () => {
    // A classifier asks for low on purpose; retrying it at medium changes what
    // the caller chose rather than giving it room.
    const { ctx, calls } = ctxReturning([{ incomplete: "max_tokens" }, { parsed: { ok: true } }]);

    await callStructured(ctx, { ...call, effort: "low" });

    expect(calls[1]!.effort).toBe("low");
  });
});
