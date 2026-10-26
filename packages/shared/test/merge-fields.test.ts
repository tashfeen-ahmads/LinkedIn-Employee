import { describe, expect, it } from "vitest";
import { renderMerge } from "../src/merge-fields.js";

/**
 * Two ways a rendered message looked machine-made to the person reading it.
 *
 * The tidy-up that closes " ." into "." also closed "…/abc ." into "…/abc.",
 * putting the full stop inside the address the prospect taps. And a missing
 * first name became "there" wherever the name stood, so a follow-up opened
 * "Thanks for connecting, there."
 */
describe("punctuation after a link", () => {
  it("is never glued onto the end of the address", () => {
    const out = renderMerge("Here it is: https://acme.test/abc . Worth a look?", {});
    expect(out).not.toContain("https://acme.test/abc.");
    expect(out).toContain("https://acme.test/abc ");
  });

  it("is dropped at the end of a line, where the stop adds nothing", () => {
    expect(renderMerge("Here it is: https://acme.test/abc .", {})).toBe("Here it is: https://acme.test/abc");
    expect(renderMerge("Here it is: https://acme.test/abc.\nThanks", {})).toBe("Here it is: https://acme.test/abc\nThanks");
  });

  it("is kept off the link placeholder too, which becomes a URL after this runs", () => {
    expect(renderMerge("Book here: {{cta_link}} .", {})).toBe("Book here: {{cta_link}}");
    expect(renderMerge("Book here: {{cta_link}}. Any time works.", {})).toBe("Book here: {{cta_link}} . Any time works.");
  });

  it("still closes up ordinary words", () => {
    expect(renderMerge("Thanks , that helps .", {})).toBe("Thanks, that helps.");
  });

  it("leaves a query string alone", () => {
    expect(renderMerge("See https://acme.test/a?b=1 for more", {})).toBe("See https://acme.test/a?b=1 for more");
  });
});

describe("a first name we do not have", () => {
  it("becomes 'there' after a greeting", () => {
    expect(renderMerge("Hi {{first_name}}, quick one.", {})).toBe("Hi there, quick one.");
    expect(renderMerge("Hey [first_name]!", {})).toBe("Hey there!");
  });

  it("is left out with its comma anywhere else", () => {
    expect(renderMerge("Thanks for connecting, {{first_name}}.", {})).toBe("Thanks for connecting.");
    expect(renderMerge("Good to meet you {{first_name}}!", {})).toBe("Good to meet you!");
    expect(renderMerge("Thanks for connecting, {{first_name}}.", { first_name: null })).not.toContain("there");
  });

  it("starts the sentence with the next word when the name opened it", () => {
    expect(renderMerge("{{first_name}}, thanks for accepting.", {})).toBe("Thanks for accepting.");
    expect(renderMerge("Great. {{first_name}}, one question.", {})).toBe("Great. One question.");
  });

  it("is still the name when we have it", () => {
    expect(renderMerge("Thanks for connecting, {{first_name}}.", { first_name: "Jane" })).toBe(
      "Thanks for connecting, Jane.",
    );
  });
});
