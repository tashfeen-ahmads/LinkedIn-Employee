import { describe, expect, it } from "vitest";
import { sequenceFor } from "../src/components/sequence";

/**
 * What a prospect receives, in order.
 *
 * The picture every competitor sells as a drag-and-drop canvas. Drawn rather
 * than dragged, because most arrangements a canvas offers are ones this product
 * refuses to send — and these assertions are about the steps a person does not
 * get to move, which is the whole reason it is drawn.
 */

const steps = [
  { step_number: 1, delay_days: 3, message: "Thanks for connecting, {{first_name}}." },
  { step_number: 2, delay_days: 4, message: "Worth a look: {{cta_link}}" },
];

describe("the sequence", () => {
  it("puts the warm-up view before the invitation, and only when warming", () => {
    // The view has to land first and close enough to still be remembered; that
    // is the entire argument for spending one.
    const warm = sequenceFor({ warmUp: true, connectionNote: "hello", steps });
    expect(warm[0]?.label).toBe("Profile view");
    expect(warm[1]?.label).toBe("Connection request");

    const cold = sequenceFor({ warmUp: false, connectionNote: "hello", steps });
    expect(cold[0]?.label).toBe("Connection request");
  });

  it("says the first follow-up is not on a schedule", () => {
    /*
     * Rule 43. What precedes step 1 is the acceptance, not a message, so
     * `delay_days` is meaningless there — and left configurable the Targeting
     * Agent wrote 3 into step 1 of every campaign this deployment ever built.
     * Three strangers accepted and heard nothing for three days. A screen still
     * showing "3 days" would be a second reading of the rule, and the screen's
     * is the one somebody believes.
     */
    const seq = sequenceFor({ warmUp: false, connectionNote: "hello", steps });
    const first = seq.find((s) => s.label === "Follow-up 1")!;
    expect(first.when).toMatch(/after they accept/);
    expect(first.when).not.toContain("3 days");
    expect(first.fixed).toMatch(/not on a schedule/);
  });

  it("keeps the configured delay from step 2 on", () => {
    // Those are measured from a message that really was sent.
    const seq = sequenceFor({ warmUp: false, connectionNote: "hello", steps });
    expect(seq.find((s) => s.label === "Follow-up 2")!.when).toBe(
      "4 days after the message before it",
    );
  });

  it("says why the invitation carries no link", () => {
    // Rule 29: LinkedIn penalises them there and they measurably cut
    // acceptance. A canvas that let somebody drop one in would be offering a
    // campaign this product refuses to send.
    const seq = sequenceFor({ warmUp: false, connectionNote: "hello", steps });
    expect(seq[0]?.fixed).toMatch(/never carrying a link/);
  });

  it("reads the steps in order whatever order they arrive in", () => {
    const seq = sequenceFor({
      warmUp: false,
      connectionNote: "hello",
      steps: [steps[1]!, steps[0]!],
    });
    expect(seq.map((s) => s.label)).toEqual([
      "Connection request",
      "Follow-up 1",
      "Follow-up 2",
    ]);
  });

  it("draws a campaign with no follow-ups at all", () => {
    // An invitation-only campaign is a real thing, not an empty state.
    const seq = sequenceFor({ warmUp: false, connectionNote: "hello", steps: [] });
    expect(seq).toHaveLength(1);
  });
});
