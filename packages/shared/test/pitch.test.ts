import { describe, expect, it } from "vitest";
import { PITCH_PLACEHOLDER, renderPitch, usesPitch } from "../src/pitch.js";

const PITCH = "Most referrals never get followed up. We match you and make the intro.";

describe("the pitch placeholder", () => {
  it("substitutes the approved pitch", () => {
    const result = renderPitch(`Hi — ${PITCH_PLACEHOLDER} Worth a look?`, PITCH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toBe(`Hi — ${PITCH} Worth a look?`);
      expect(result.message).not.toContain(PITCH_PLACEHOLDER);
    }
  });

  it("refuses rather than sending the placeholder as words", () => {
    /*
     * The whole difference from `renderCta`. A missing destination costs a
     * link and a visible `{{cta_link}}` is caught on the review screen. A
     * missing pitch is the entire body of the message, so what would go out is
     * the literal characters `{{pitch}}` under a real rep's name.
     */
    const result = renderPitch(`Hi — ${PITCH_PLACEHOLDER}`, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no approved pitch/i);
  });

  it("refuses a pitch that is only whitespace", () => {
    // An approved row holding spaces is not an approved pitch, and it would
    // otherwise substitute to a greeting with nothing after it.
    expect(renderPitch(`Hi — ${PITCH_PLACEHOLDER}`, "   ").ok).toBe(false);
  });

  it("leaves a message that does not use the pitch completely alone", () => {
    // Every other campaign in the product still works exactly as it did, with
    // or without a pitch in the workspace.
    const plain = "Hi there, is that something you own?";
    const result = renderPitch(plain, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toBe(plain);
  });

  it("knows which messages depend on a pitch", () => {
    expect(usesPitch(`a ${PITCH_PLACEHOLDER} b`)).toBe(true);
    expect(usesPitch("a b")).toBe(false);
  });

  it("substitutes every occurrence, not only the first", () => {
    // Two copies of the pitch in one message is bad copy, but half a
    // substitution is a bug: the second placeholder would go out verbatim.
    const result = renderPitch(`${PITCH_PLACEHOLDER} … ${PITCH_PLACEHOLDER}`, PITCH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).not.toContain(PITCH_PLACEHOLDER);
  });
});
