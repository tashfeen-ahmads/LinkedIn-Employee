import { describe, expect, it } from "vitest";
import { TOUR_STAGES, YOUR_DECISIONS, type StageOwner } from "../src/tour.js";

/**
 * What the product asks of a person, counted rather than asserted.
 *
 * Six of nine stage titles used to open with the word "You", and a reader
 * concluded the founder does most of the work. They were reading it correctly.
 * Two of those six were signing up — answered once and never again — and one
 * was the reply stage, which the agent has run on its own since autopilot
 * shipped. The page was describing the supervised default as though it were
 * the only mode.
 *
 * So the count is the test. A stage added as "yours" without being one of the
 * three gates the code actually enforces has to be argued for here, where the
 * number is visible, rather than slipped into a list nobody counts.
 */
const by = (owner: StageOwner) => TOUR_STAGES.filter((stage) => stage.owner === owner);

describe("what the tour asks of a person", () => {
  it("names exactly three standing decisions", () => {
    expect(YOUR_DECISIONS).toHaveLength(3);
    expect(by("decision")).toHaveLength(3);
  });

  it("every decision stage says what the person does", () => {
    // A stage that is somebody's decision and lists nothing for them to do is
    // either mislabelled or a step the product invented for itself.
    for (const stage of by("decision")) {
      expect(stage.youDo, `${stage.id} is a decision with no action`).toBeTruthy();
    }
  });

  it("no stage the agent runs asks anything of a person", () => {
    // This is the one that broke. The reply stage read "you send them" while
    // the agent was sending them.
    for (const stage of by("agent")) {
      expect(stage.youDo, `${stage.id} runs by itself but still lists work`).toBeNull();
    }
  });

  it("the agents do more of the work than the person does", () => {
    // Not a style rule — it is the product's whole claim, and it was false on
    // the page while being true in the code.
    expect(by("agent").length).toBeGreaterThan(by("decision").length);
  });

  it("counts signing up as setup, not as recurring work", () => {
    const setup = by("setup").map((stage) => stage.id);
    expect(setup).toContain("business");
    expect(setup).toContain("connect");
  });

  it("every stage is owned by somebody", () => {
    const owners: StageOwner[] = ["setup", "decision", "agent", "outside"];
    for (const stage of TOUR_STAGES) {
      expect(owners, `${stage.id} has no owner`).toContain(stage.owner);
    }
  });

  it("every decision points at the screen where it happens", () => {
    for (const decision of YOUR_DECISIONS) {
      expect(decision.href.startsWith("/app/"), decision.title).toBe(true);
    }
    // And each says why it is not automated. "Because we said so" is what
    // makes a gate feel like friction rather than a reason.
    for (const decision of YOUR_DECISIONS) {
      expect(decision.because.length, decision.title).toBeGreaterThan(40);
    }
  });
});
