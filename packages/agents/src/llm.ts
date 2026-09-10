import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { MODELS } from "@le/shared";
import type { z } from "zod";

/**
 * One shape for a structured model call, and two implementations of it.
 *
 * Every agent in this product produces JSON that is validated before it reaches
 * the database, so the only thing a provider has to do is take a schema and
 * return something that satisfies it. That is a small enough surface to write
 * twice, and writing it twice is what stops the choice of provider leaking into
 * eight agent files.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface LlmSystemBlock {
  text: string;
  /**
   * True for the stable part of the prompt — business profile, customer
   * profile, rep bio — which is identical across every message in a campaign.
   *
   * Anthropic needs the breakpoint marked. OpenAI caches an identical prefix
   * automatically and has nothing to mark, so there the flag only documents
   * intent — but the ordering it implies is load-bearing for both: stable
   * content first, or neither provider can cache anything.
   */
  cached?: boolean;
}

export interface LlmRequest {
  model: string;
  maxTokens: number;
  system: LlmSystemBlock[];
  user: string;
  schema: z.ZodTypeAny;
  effort?: Effort;
}

export interface LlmUsageCounts {
  /**
   * Tokens charged at the full input rate. Cache reads are NOT included here —
   * they are billed at their own rate and counted separately, which is the
   * arithmetic `estimateCostUsd` does.
   */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface LlmResponse {
  /** Already validated against the request's schema by the provider helper. */
  parsed: unknown;
  /** The refusal category when the model declined, otherwise null. */
  refusal: string | null;
  usage: LlmUsageCounts;
}

/** The two model roles this product uses, named by the provider's own ids. */
export interface AgentModels {
  /** Customer-visible writing: profiles, campaign copy, reply drafts. */
  writer: string;
  /** High-volume classification and scoring. */
  classifier: string;
}

export interface LlmClient {
  readonly provider: "openai" | "anthropic";
  readonly models: AgentModels;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/* ----------------------------------------------------------------- openai */

/** Reasoning effort, in OpenAI's four levels rather than Anthropic's five. */
function openAiEffort(effort: Effort | undefined): "low" | "medium" | "high" | undefined {
  if (!effort) return undefined;
  return effort === "xhigh" || effort === "max" ? "high" : effort;
}

export interface OpenAiOptions {
  apiKey?: string;
  models?: AgentModels;
}

export const OPENAI_MODELS: AgentModels = MODELS.openai;

export class OpenAiClient implements LlmClient {
  readonly provider = "openai" as const;
  readonly models: AgentModels;
  private readonly client: OpenAI;

  constructor(options: OpenAiOptions = {}) {
    this.client = new OpenAI(options.apiKey ? { apiKey: options.apiKey } : {});
    this.models = options.models ?? OPENAI_MODELS;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.responses.parse({
      model: request.model,
      max_output_tokens: request.maxTokens,
      input: [
        // Stable blocks first, in order, so the cached prefix is as long as it
        // can be. Joined into one system message: OpenAI matches a prefix by
        // its text, and how it was split on the way in makes no difference.
        { role: "system", content: request.system.map((block) => block.text).join("\n\n") },
        { role: "user", content: request.user },
      ],
      text: { format: zodTextFormat(request.schema, "output") },
      ...(openAiEffort(request.effort) ? { reasoning: { effort: openAiEffort(request.effort) } } : {}),
    });

    const cacheReadTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
    const inputTokens = response.usage?.input_tokens ?? 0;

    return {
      parsed: response.output_parsed ?? null,
      refusal: findRefusal(response),
      usage: {
        // OpenAI reports cached tokens as a subset of input_tokens; Anthropic
        // reports them as a separate count. The cost model expects the second
        // shape, so subtract here — otherwise every cached token is billed
        // twice, at the full rate and again at the cache rate, and the usage
        // page reports a number that is wrong in the flattering direction.
        inputTokens: Math.max(0, inputTokens - cacheReadTokens),
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens,
      },
    };
  }
}

/** OpenAI reports a refusal as a content part, not a stop reason. */
function findRefusal(response: { output?: unknown }): string | null {
  const output = response.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if ((part as { type?: string }).type === "refusal") {
        return (part as { refusal?: string }).refusal ?? "unspecified";
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------- anthropic */

export interface AnthropicOptions {
  apiKey?: string;
  models?: AgentModels;
}

export const ANTHROPIC_MODELS: AgentModels = MODELS.anthropic;

export class AnthropicClient implements LlmClient {
  readonly provider = "anthropic" as const;
  readonly models: AgentModels;
  private readonly client: Anthropic;

  constructor(options: AnthropicOptions = {}) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.models = options.models ?? ANTHROPIC_MODELS;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.messages.parse({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system.map((block) => ({
        type: "text" as const,
        text: block.text,
        ...(block.cached ? { cache_control: { type: "ephemeral" as const } } : {}),
      })),
      messages: [{ role: "user", content: request.user }],
      output_config: {
        format: zodOutputFormat(request.schema),
        ...(request.effort ? { effort: request.effort } : {}),
      },
    });

    return {
      parsed: response.parsed_output ?? null,
      refusal:
        response.stop_reason === "refusal" ? (response.stop_details?.category ?? "unspecified") : null,
      usage: {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}

/* --------------------------------------------------------------- selection */

export interface LlmEnv {
  LLM_PROVIDER?: "openai" | "anthropic";
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

/**
 * Picks a provider from the keys that are actually present.
 *
 * An explicit LLM_PROVIDER wins, so a deployment holding both keys is never
 * ambiguous. Otherwise whichever key exists decides — which means a deployment
 * is configured by pasting one key, not by pasting a key and then remembering
 * to set a second variable that names it.
 */
export function createLlmClient(env: LlmEnv): LlmClient {
  const provider = env.LLM_PROVIDER ?? (env.OPENAI_API_KEY ? "openai" : env.ANTHROPIC_API_KEY ? "anthropic" : null);
  if (!provider) {
    throw new Error("No model provider configured: set OPENAI_API_KEY or ANTHROPIC_API_KEY");
  }
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is not set");
    return new OpenAiClient({ apiKey: env.OPENAI_API_KEY });
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
  return new AnthropicClient({ apiKey: env.ANTHROPIC_API_KEY });
}
