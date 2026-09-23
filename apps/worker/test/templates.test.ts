import { describe, expect, it } from "vitest";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { addDays, inviteNote, mergeValuesFor, renderTemplate } from "../src/jobs/linkedin-action.js";

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

  /**
   * A campaign testing two angles measures each by what its group received. A
   * prospect whose note could not be written is still counted under the angle
   * they were assigned — so if they receive the campaign's generic line
   * instead, the results table is describing a group that partly got something
   * else, and the whole comparison is quietly wrong.
   */
  it("falls back to the angle the person was assigned, not the campaign's note", () => {
    const angleNote = "Hi {{first_name}}, most referrals never get a second touch.";
    expect(inviteNote(null, TEMPLATE, "Jane", angleNote)).toBe(
      "Hi Jane, most referrals never get a second touch.",
    );
  });

  it("uses the campaign's note when the person was assigned no angle", () => {
    // Every campaign built before angles existed, and every campaign whose
    // angles could not be stored.
    expect(inviteNote(null, TEMPLATE, "Jane", null)).toBe("Hi Jane, we work with heads of ops.");
  });

  /**
   * LinkedIn penalises links in connection requests and they measurably cut
   * acceptance. The prompt already says not to, and the prompt saying so is not
   * what makes it true: a model that ignores the instruction once, or a human
   * who pastes a URL into a template, reaches a real account with real
   * standing.
   */
  it("never sends a connection request carrying a link", () => {
    expect(inviteNote("Take a look: https://acme.test", TEMPLATE, "Jane")).toBe(
      "Hi Jane, we work with heads of ops.",
    );
  });

  it("sends no note at all rather than a template with a link in it", () => {
    // Dropping to no note is right; surgically removing the URL is not. An
    // invitation with no note is ordinary on LinkedIn and costs a little
    // acceptance, while "Take a look: " with nothing after it reads as broken.
    expect(inviteNote(null, "Take a look: https://acme.test", "Jane")).toBe("");
  });

  it("catches the placeholder as well as a written-out address", () => {
    // The substitution never runs on the invitation path, so a stray
    // {{cta_link}} would otherwise go out literally.
    expect(inviteNote("Try it {{cta_link}}", TEMPLATE, "Jane")).toBe(
      "Hi Jane, we work with heads of ops.",
    );
  });

  it("prefers the written note over either fallback", () => {
    // The angle's note is a fallback, not an override: a note written for this
    // named person already leans on the angle they were assigned.
    expect(inviteNote("Written for Jane.", TEMPLATE, "Jane", "Angle note.")).toBe("Written for Jane.");
  });

  it("treats a blank note as absent rather than sending nothing", () => {
    // LinkedIn delivers an invitation with an empty note perfectly happily, so
    // an empty string here would quietly turn a personalised campaign into a
    // bare connection request nobody chose to send.
    expect(inviteNote("   ", TEMPLATE, "Jane")).toBe("Hi Jane, we work with heads of ops.");
    expect(inviteNote("", TEMPLATE, null)).toBe("Hi there, we work with heads of ops.");
  });
});

describe("the note that is actually sent", () => {
  const LONG = "x".repeat(INVITE_NOTE_MAX_CHARS + 1);
  const OK = "Hi {{first_name}}, a short and legitimate note.";

  it("falls back when the personalised note is too long", () => {
    expect(inviteNote(LONG, OK, "Sam")).toBe("Hi Sam, a short and legitimate note.");
  });

  it("sends no note rather than a template that is also too long", () => {
    /*
     * The bug this catches, and it shipped as half a fix.
     *
     * A 240-character personalised note correctly fell back to the campaign's
     * template — which was 222 characters — so the invitation was refused for
     * exactly the same reason and the screen said exactly the same thing. A
     * guard has to cover the value that is sent, not the one rejected first.
     *
     * An invitation with no note always succeeds and costs a little
     * acceptance. A refused one costs the contact and a slot off a capped
     * daily allowance.
     */
    expect(inviteNote(LONG, LONG, "Sam")).toBe("");
  });

  it("never truncates, at either step", () => {
    // A sentence cut at the limit reaches a real person mid-word under a real
    // rep's name, which is worse than the template and worse than no note.
    const out = inviteNote(LONG, LONG, "Sam");
    expect(out).not.toMatch(/^x+$/);
    expect(out.length === 0 || out.length <= INVITE_NOTE_MAX_CHARS).toBe(true);
  });
});

describe("placeholders people actually type", () => {
  /*
   * Every campaign and follow-up in the first live deployment was written with
   * `[Name]`, and only `{{first_name}}` was substituted — so the first real
   * follow-up would have opened "Thanks for connecting, [Name]." under a real
   * rep's name. The old comment called that "literal by design".
   */
  const forms = [
    "{{first_name}}",
    "{{ first_name }}",
    "{{firstName}}",
    "{first_name}",
    "[Name]",
    "[name]",
    "[First Name]",
    "[FIRST_NAME]",
    "[fname]",
  ];

  for (const form of forms) {
    it(`substitutes ${form}`, () => {
      expect(renderTemplate(`Hi ${form}, thanks.`, "Parisa")).toBe("Hi Parisa, thanks.");
    });
  }

  it("falls back to a word, never to a hole", () => {
    expect(renderTemplate("Hi [Name], thanks.", null)).toBe("Hi there, thanks.");
    expect(renderTemplate("Hi [Name], thanks.", "   ")).toBe("Hi there, thanks.");
  });

  it("leaves text that only looks like a placeholder alone", () => {
    // A bracket is not a placeholder. Substituting anything bracketed would
    // rewrite the author's words.
    expect(renderTemplate("We ship [beta] in Q1, {{cta_link}}", "Sam")).toBe(
      "We ship [beta] in Q1, {{cta_link}}",
    );
  });
});

describe("merge fields on a real prospect", () => {
  /*
   * The openers this was built for. Both shapes come from the same template:
   * one sentence when we know the company, a different sentence when we do not.
   */
  const OPENER =
    "Hi {{first_name}}, {{rep_name}} here{{#company}} regarding {{company}}{{/company}}.{{^company}} Are you the owner of the business?{{/company}}";

  it("names the company it read out of the headline", () => {
    const values = mergeValuesFor(
      { first_name: "Kristina", headline: "Servant Leader | Owner of The Wynners Club | Business Broker" },
      { full_name: "Tashfeen" },
    );
    expect(renderTemplate(OPENER, "Kristina", values)).toBe(
      "Hi Kristina, Tashfeen here regarding The Wynners Club.",
    );
  });

  it("asks instead when the headline names no company", () => {
    // A real prospect whose headline is a list of services. Guessing here
    // produces "regarding your Photo-realistic Product Animation".
    const values = mergeValuesFor(
      { first_name: "Desmond", headline: "Photo-realistic Product Animation | 3D Modeling for Prototypes" },
      { full_name: "Tashfeen" },
    );
    expect(renderTemplate(OPENER, "Desmond", values)).toBe(
      "Hi Desmond, Tashfeen here. Are you the owner of the business?",
    );
  });

  it("prefers the column the provider confirmed over the headline", () => {
    // A company LinkedIn actually returned outranks anything read out of free
    // text, whatever the headline happens to say.
    const values = mergeValuesFor(
      { first_name: "Jane", company: "Confirmed Co", headline: "CEO at Something Else LLC" },
      { full_name: "Tashfeen" },
    );
    expect(values.company).toBe("Confirmed Co");
  });

  it("still reads {{name}} and [Name] as the first name", () => {
    // Both reached real prospects verbatim before this existed.
    expect(renderTemplate("Hi [Name]", "Jane", {})).toBe("Hi Jane");
    expect(renderTemplate("Hi {{name}}", "Jane", {})).toBe("Hi Jane");
  });
});
