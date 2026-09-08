import { describe, expect, it } from "vitest";
import { addDays, renderTemplate } from "../src/jobs/linkedin-action.js";

describe("renderTemplate", () => {
  it("substitutes the first name", () => {
    expect(renderTemplate("Hi {{first_name}}, saw your post.", "Jane")).toBe("Hi Jane, saw your post.");
  });

  it("tolerates whitespace and casing in the token", () => {
    expect(renderTemplate("Hi {{ First_Name }}", "Jane")).toBe("Hi Jane");
  });

  it("falls back to a neutral greeting rather than an empty gap", () => {
    expect(renderTemplate("Hi {{first_name}},", null)).toBe("Hi there,");
    expect(renderTemplate("Hi {{first_name}},", "   ")).toBe("Hi there,");
  });

  it("leaves unknown tokens alone instead of guessing", () => {
    expect(renderTemplate("Hi {{company}}", "Jane")).toBe("Hi {{company}}");
  });
});

describe("addDays", () => {
  it("advances by whole days", () => {
    expect(addDays(new Date("2026-09-08T10:00:00Z"), 3).toISOString()).toBe("2026-09-11T10:00:00.000Z");
  });
});
