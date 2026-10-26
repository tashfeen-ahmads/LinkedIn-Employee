import { describe, expect, it, vi } from "vitest";
import { runStrategyAgent } from "../src/strategy.js";

/*
 * Nothing fetches a LinkedIn company page, so a run given only that address
 * was a run given nothing, and the model answered with a blank business and a
 * blank strategy that a person could approve.
 */
describe("runStrategyAgent's material check", () => {
  const ctx = { client: { models: { writer: "w" } } } as never;

  it("refuses a LinkedIn page on its own", async () => {
    await expect(
      runStrategyAgent(ctx, { linkedinCompanyUrl: "https://linkedin.com/company/acme" }),
    ).rejects.toThrow(/LinkedIn page alone cannot be read/);
  });

  it("refuses a description that is only whitespace", async () => {
    await expect(runStrategyAgent(ctx, { description: "   " })).rejects.toThrow(/website or a few sentences/);
  });

  it("goes on to the model with a website or a description beside the LinkedIn page", async () => {
    // The check passes, so the call reaches the client — which this stub does
    // not have, and that is the proof it got past the refusal.
    const call = vi.fn();
    const withClient = { client: { models: { writer: "w" }, call } } as never;
    const outcome = runStrategyAgent(withClient, {
      linkedinCompanyUrl: "https://linkedin.com/company/acme",
      description: "We fit heat pumps in Leeds.",
    });
    await expect(outcome).rejects.not.toThrow(/LinkedIn page alone/);
  });
});
