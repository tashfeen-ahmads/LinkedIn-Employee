import type { z } from "zod";
import type { Effort, LlmClient, LlmSystemBlock } from "./llm.js";

export interface LlmUsage {
  agent: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
  error?: string;
}

/** Where usage records go. The worker writes them to the llm_calls table. */
export type UsageSink = (usage: LlmUsage) => void | Promise<void>;

export interface AgentContext {
  client: LlmClient;
  onUsage?: UsageSink;
}

export interface StructuredCall<T extends z.ZodTypeAny> {
  agent: string;
  model: string;
  promptVersion: string;
  schema: T;
  system: LlmSystemBlock[];
  userContent: string;
  maxTokens?: number;
  effort?: Effort;
}

/**
 * One structured call to a model, validated against a Zod schema before the
 * result is allowed anywhere near the database.
 *
 * Which provider answers is decided once, in `createLlmClient`. Everything
 * here — the usage accounting, the refusal handling, the schema guarantee — is
 * the same either way, which is the point of the seam.
 *
 * The system blocks are ordered stable-content-first and the stable ones are
 * marked: for reply drafting the business profile, customer profile and rep bio
 * are identical across every message in a campaign, so only the new
 * conversation is charged at full rate.
 */
export async function callStructured<T extends z.ZodTypeAny>(
  ctx: AgentContext,
  call: StructuredCall<T>,
): Promise<z.infer<T>> {
  try {
    return await attempt(ctx, call);
  } catch (error) {
    // A reasoning model spends its thinking against the same budget as its
    // answer, so a high effort setting and a generous-looking maxTokens can
    // produce a wholly successful call containing nothing at all. That is a
    // budget we set wrong, not a model that misbehaved, and it is fixable
    // without anybody being told -- once.
    //
    // Retried with the effort lowered rather than only the budget raised:
    // doubling the budget for the same thinking usually buys more thinking.
    // The task here is writing, and writing does not need the highest setting.
    if (!(error instanceof TruncatedOutputError)) throw error;
    console.warn(`${call.agent}: ran out of budget while thinking; retrying with more room`);
    return attempt(ctx, {
      ...call,
      maxTokens: (call.maxTokens ?? 16000) * 2,
      effort: call.effort === "low" ? "low" : "medium",
    });
  }
}

/**
 * The output ran out of room before the answer began.
 *
 * Separate from every other empty response because it has a different fix: a
 * model ignoring its schema needs a different prompt, a model that thought
 * until its budget was gone needs a bigger one.
 */
export class TruncatedOutputError extends Error {
  constructor(readonly agent: string) {
    super(`${agent}: the model used its whole token budget before producing an answer`);
    this.name = "TruncatedOutputError";
  }
}

async function attempt<T extends z.ZodTypeAny>(
  ctx: AgentContext,
  call: StructuredCall<T>,
): Promise<z.infer<T>> {
  const startedAt = Date.now();
  // A refusal and an unparsable response are both recorded by the success path
  // above before they throw. Without this flag the catch records a second,
  // token-less row and every refusal is counted twice in cost reporting.
  let usageRecorded = false;
  try {
    const response = await ctx.client.complete({
      model: call.model,
      maxTokens: call.maxTokens ?? 16000,
      system: call.system,
      user: call.userContent,
      schema: call.schema,
      effort: call.effort,
    });

    await ctx.onUsage?.({
      agent: call.agent,
      model: call.model,
      promptVersion: call.promptVersion,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      latencyMs: Date.now() - startedAt,
    });
    usageRecorded = true;

    if (response.refusal !== null) {
      throw new AgentRefusalError(call.agent, response.refusal);
    }
    if (response.parsed == null) {
      if (response.incomplete === "max_tokens") throw new TruncatedOutputError(call.agent);
      throw new Error(`${call.agent}: model returned no parsable output`);
    }
    return response.parsed as z.infer<T>;
  } catch (error) {
    if (usageRecorded) throw error;
    await ctx.onUsage?.({
      agent: call.agent,
      model: call.model,
      promptVersion: call.promptVersion,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export class AgentRefusalError extends Error {
  constructor(
    readonly agent: string,
    readonly category: string | null,
  ) {
    super(`${agent}: request was declined by the model (${category ?? "unspecified"})`);
    this.name = "AgentRefusalError";
  }
}
