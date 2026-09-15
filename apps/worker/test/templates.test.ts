import { describe, expect, it } from "vitest";
import { addDays, inviteNote, renderTemplate } from "../src/jobs/linkedin-action.js";

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

describe("inviteNote", () => {
  const TEMPLATE = "Hi {{first_name}}, we work with heads of ops.";

  it("sends the note written for this person, untouched", () => {
    // Already written for one named person. Running it through the template
    // renderer would at best do nothing and at worst rewrite the writer's
    // words — and these words reach a real person under a real rep's name.
    const written = "Noticed you run RevOps at Acme after the Series B. Curious how you handle handoffs.";
    expect(inviteNote(written, TEMPLATE, "Jane")).toBe(written);
  });

  it("does not substitute into a personalised note", () => {
    const written = "Hi {{first_name}} — literal braces should survive.";
    expect(inviteNote(written, TEMPLATE, "Jane")).toBe(written);
  });

  it("falls back to the campaign template when there is no note", () => {
    // Every campaign built before personalised notes existed has null here,
    // and must keep sending exactly what it sent yesterday.
    expect(inviteNote(null, TEMPLATE, "Jane")).toBe("Hi Jane, we work with heads of ops.");
  });

  it("treats a blank note as absent rather than sending nothing", () => {
    // LinkedIn delivers an invitation with an empty note perfectly happily, so
    // an empty string here would quietly turn a personalised campaign into a
    // bare connection request nobody chose to send.
    expect(inviteNote("   ", TEMPLATE, "Jane")).toBe("Hi Jane, we work with heads of ops.");
    expect(inviteNote("", TEMPLATE, null)).toBe("Hi there, we work with heads of ops.");
  });
});
