import { StrategyOutputSchema, type StrategyOutput } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { STRATEGY_PROMPT_VERSION, STRATEGY_SYSTEM, strategyUserPrompt } from "./prompts/strategy.js";

export interface StrategyInput {
  websiteUrl?: string;
  linkedinCompanyUrl?: string;
  description?: string;
  websiteText?: string;
  existingCustomers?: string[];
}

/**
 * Agent 1. Turns whatever a company says about itself into a Business Profile
 * and 3 to 5 Customer Profiles, each carrying the Sales Navigator filters the
 * Targeting Agent will execute.
 */
export async function runStrategyAgent(ctx: AgentContext, input: StrategyInput): Promise<StrategyOutput> {
  if (!input.websiteUrl && !input.linkedinCompanyUrl && !input.description && !input.websiteText) {
    throw new Error("Strategy Agent needs at least a website, a LinkedIn page, or a description");
  }

  return callStructured(ctx, {
    agent: "strategy",
    model: ctx.client.models.writer,
    promptVersion: STRATEGY_PROMPT_VERSION,
    schema: StrategyOutputSchema,
    // The system prompt is identical for every workspace, so it caches across
    // all strategy runs rather than only within one.
    system: [{ text: STRATEGY_SYSTEM, cached: true }],
    userContent: strategyUserPrompt(input),
    effort: "high",
    maxTokens: 16000,
  });
}

/** Strip boilerplate from scraped pages so the model reads copy, not chrome. */
export function cleanWebsiteText(html: string, maxChars = 24_000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
