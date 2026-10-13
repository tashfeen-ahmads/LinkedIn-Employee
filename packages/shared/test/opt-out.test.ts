import { describe, expect, it } from "vitest";
import { findOptOutPhrase, normalizeForOptOut } from "../src/opt-out.js";

describe("normalizeForOptOut", () => {
  it("straightens every apostrophe a phone or word processor types", () => {
    for (const mark of ["\u2019", "\u2018", "\u02bc", "`", "\u00b4"]) {
      expect(normalizeForOptOut(`Don${mark}t`)).toBe("don't");
    }
  });

  it("folds compatibility forms, drops invisible joiners and collapses whitespace", () => {
    expect(normalizeForOptOut("\uff32\uff45\uff4d\uff4f\uff56\uff45")).toBe("remove");
    expect(normalizeForOptOut("re\u200bmove \n\t me")).toBe("remove me");
  });
});

describe("findOptOutPhrase", () => {
  it("names the phrase a curly-apostrophe message matched", () => {
    expect(findOptOutPhrase("Please don\u2019t contact me")).toBe("don't contact");
  });

  it("finds nothing in an ordinary reply", () => {
    expect(findOptOutPhrase("Sounds good, what does Thursday look like?")).toBeNull();
  });
});
