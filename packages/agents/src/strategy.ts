import { StrategyOutputSchema, type StrategyOutput } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { STRATEGY_PROMPT_VERSION, STRATEGY_SYSTEM, strategyUserPrompt } from "./prompts/strategy.js";

export interface StrategyInput {
  websiteUrl?: string;
  linkedinCompanyUrl?: string;
  description?: string;
  websiteText?: string;
  existingCustomers?: string[];
  /** Strategies already in the workspace, when asking for more. */
  existingProfiles?: { name: string; summary?: string }[];
  /** How many more to write. Only read alongside `existingProfiles`. */
  want?: number;
  /** Who the owner says they actually sell to, after rejecting the suggestions. */
  guidance?: string;
}

/**
 * Agent 1. Turns whatever a company says about itself into a Business Profile
 * and 3 to 5 Customer Profiles, each carrying the Sales Navigator filters the
 * Targeting Agent will execute.
 */
export async function runStrategyAgent(ctx: AgentContext, input: StrategyInput): Promise<StrategyOutput> {
  // A run that is adding to an existing set works from the business profile and
  // the strategies already written, which is more material than a first run
  // ever has. Requiring the website again would make "write me four more" fail
  // for every workspace that onboarded with a description.
  //
  // A LinkedIn company page is not material on its own: nothing fetches it
  // (LinkedIn serves nothing readable to a stranger's request), so a run
  // given only that address is a run given only a URL, and the model fills a
  // business profile and a strategy with empty strings that a person can then
  // approve. It still travels as a hint beside a website or a description.
  const hasMaterial =
    input.websiteUrl ||
    input.description?.trim() ||
    input.websiteText ||
    input.existingProfiles?.length;
  if (!hasMaterial) {
    throw new Error(
      "Sage needs your website or a few sentences about what you sell. A LinkedIn page alone cannot be read.",
    );
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
