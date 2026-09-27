import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "../src");
const read = (p: string) => readFileSync(join(src, p), "utf8");

/**
 * What the agents cost, decided deliberately rather than by default.
 *
 * A reasoning model bills its thinking as output. Measured over this
 * deployment's first month: 85k input tokens against 381k output, with output
 * priced at roughly four times input — so about ninety-five percent of the
 * bill was the models thinking, not reading or answering.
 *
 * Two calls set no effort at all and took whatever the default was.
 * `targeting.fit` spent an average of 4,314 output tokens returning a score
 * and a sentence per prospect, three times what it was given to read. That is
 * the largest line on the bill, and it is a rubric being applied.
 */
describe("reasoning effort", () => {
  it("offers the cheapest rung the provider has", () => {
    // It was missing from the scale entirely, so no caller could ask for it.
    expect(read("llm.ts")).toContain('"minimal"');
  });

  it("gives every model call an explicit effort", () => {
    /*
     * The failure this catches is silence: a call with no effort takes the
     * provider's default, which is neither cheap nor written down anywhere in
     * this repo. Both of the calls that did cost the most.
     */
    for (const file of ["targeting.ts", "strategy.ts", "reply.ts", "hook.ts", "pitch.ts"]) {
      const source = read(file);
      const calls = source.match(/agent: "/g)?.length ?? 0;
      const efforts = source.match(/effort: "/g)?.length ?? 0;
      expect(efforts, `${file} has ${calls} model calls and ${efforts} efforts`).toBeGreaterThanOrEqual(calls);
    }
  });

  it("scores prospects at minimal effort", () => {
    // Applying a rubric, not deliberating. The fields are in the schema and
    // the rubric is in the prompt; longer thinking bought a longer path to the
    // same shape.
    const targeting = read("targeting.ts");
    const fit = targeting.slice(targeting.indexOf('agent: "targeting.fit"'));
    expect(fit.slice(0, 2000)).toContain('effort: "minimal"');
  });

  it("never raises effort on a retry", () => {
    /*
     * The retry doubles the budget when a call runs out of room. Promoting a
     * minimal call to medium at the same time would make a deliberately cheap
     * task expensive on exactly the runs already costing the most.
     */
    const client = read("client.ts");
    expect(client).toContain('call.effort === "minimal" || call.effort === "low" ? call.effort : "medium"');
  });

  it("translates the scale for Anthropic rather than passing it through", () => {
    // `minimal` is not a value that API accepts, and the call that would fail
    // is the cheapest one — the last place anybody looks when the bill is the
    // complaint.
    expect(read("llm.ts")).toContain("anthropicEffort");
  });
});
