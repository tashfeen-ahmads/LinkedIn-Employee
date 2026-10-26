import { describe, expect, it } from "vitest";
import { STRATEGY_PROMPT_VERSION, STRATEGY_SYSTEM } from "../src/prompts/strategy.js";

/**
 * The words the Strategy Agent writes become LinkedIn searches (rule 12), and
 * LinkedIn searches places and industries only by its own names. A pre-2022
 * industry name or "New York, NY" is dropped, or worse, matched to something
 * else, so the agent is told LinkedIn's current names up front.
 */
describe("the Strategy Agent is told LinkedIn's own names", () => {
  it("lists the current industry names beside the old ones", () => {
    for (const [current, old] of [
      ["Software Development", "Computer Software"],
      ["IT Services and IT Consulting", "Information Technology and Services"],
      ["Hospitals and Health Care", "Hospital & Health Care"],
      ["Business Consulting and Services", "Management Consulting"],
      ["Wellness and Fitness Services", "Health, Wellness & Fitness"],
      ["Advertising Services", "Marketing and Advertising"],
      ["Education Administration Programs", "Education Management"],
    ]) {
      expect(STRATEGY_SYSTEM).toContain(`"${current}" (not "${old}")`);
    }
  });

  it("asks for whole place names with their region, never an abbreviation", () => {
    expect(STRATEGY_SYSTEM).toContain('"New York, New York, United States"');
    expect(STRATEGY_SYSTEM).toMatch(/Never an abbreviation like "NY"/);
  });

  it("carries a new prompt version", () => {
    expect(STRATEGY_PROMPT_VERSION).toBe("strategy/2026-10-26-linkedin-taxonomy");
  });
});
