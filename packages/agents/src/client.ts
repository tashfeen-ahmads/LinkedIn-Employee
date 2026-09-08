import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

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
  client: Anthropic;
  onUsage?: UsageSink;
}

export function createAnthropic(apiKey?: string): Anthropic {
  return new Anthropic(apiKey ? { apiKey } : {});
}

export interface StructuredCall<T extends z.ZodTypeAny> {
  agent: string;
  model: string;
  promptVersion: string;
  schema: T;
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  userContent: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * One structured call to Claude, validated against a Zod schema before the
 * result is allowed anywhere near the database.
 *
 * The system blocks are cached: for reply drafting the business profile,
 * customer profile and rep bio are identical across every message in a
 * campaign, so only the new conversation is charged at full rate.
 */
export async function callStructured<T extends z.ZodTypeAny>(
  ctx: AgentContext,
  call: StructuredCall<T>,
): Promise<z.infer<T>> {
  const startedAt = Date.now();
  try {
    const response = await ctx.client.messages.parse({
      model: call.model,
      max_tokens: call.maxTokens ?? 16000,
      system: call.system,
      messages: [{ role: "user", content: call.userContent }],
      output_config: {
        format: zodOutputFormat(call.schema),
        ...(call.effort ? { effort: call.effort } : {}),
      },
    });

    await ctx.onUsage?.({
      agent: call.agent,
      model: call.model,
      promptVersion: call.promptVersion,
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    });

    if (response.stop_reason === "refusal") {
      throw new AgentRefusalError(call.agent, response.stop_details?.category ?? null);
    }
    if (response.parsed_output == null) {
      throw new Error(`${call.agent}: model returned no parsable output`);
    }
    return response.parsed_output as z.infer<T>;
  } catch (error) {
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
