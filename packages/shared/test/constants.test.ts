import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVITE_NOTE_MAX_CHARS } from "../src/constants.js";

describe("the invitation note limit", () => {
  it("is LinkedIn's free-account limit, not Premium's", () => {
    /*
     * 300 is the Premium number and it was in four places at once: the prompt,
     * the schema, the second check in `personalizeInvites`, and the comment
     * above that check explaining it was LinkedIn's. All four agreed with each
     * other and none of them agreed with the account doing the sending.
     *
     * LinkedIn does not truncate a note over the limit. It refuses the whole
     * invitation — `400 errors/too_many_characters` — which spends nothing but
     * costs a real person on a reviewed list, and reads on screen as a prospect
     * who was simply never contacted.
     */
    expect(INVITE_NOTE_MAX_CHARS).toBe(200);
  });

  it("is the number the prompt asks the writer for", () => {
    // A cap the model is not told about produces notes that are rejected after
    // they are written, scored, stored and reviewed. Both numbers or neither.
    const prompts = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../agents/src/prompts/targeting.ts"),
      "utf8",
    );
    expect(prompts).toContain(`${INVITE_NOTE_MAX_CHARS} characters maximum`);
    expect(prompts, "the old Premium limit is still being asked for").not.toMatch(
      /under 300 characters/,
    );
  });
});
