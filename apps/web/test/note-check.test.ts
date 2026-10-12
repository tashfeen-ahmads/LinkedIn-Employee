import { describe, expect, it } from "vitest";
import { INVITE_NOTE_MAX_CHARS, containsLink } from "@le/shared";
import { LINKEDIN_NOTE_LIMITS, checkNote, lengthStatus, pitchFindings } from "../src/lib/note-check";

const ids = (text: string) => checkNote(text).findings.map((f) => f.id);

describe("connection note checker", () => {
  it("measures length the way the sender does, against Nora's own cap", () => {
    const note = "x".repeat(INVITE_NOTE_MAX_CHARS);
    expect(checkNote(note)).toMatchObject({ length: INVITE_NOTE_MAX_CHARS, status: "fits", overBy: 0 });
    expect(checkNote(note + "y")).toMatchObject({ status: "premium_only", overBy: 1 });
    expect(lengthStatus(LINKEDIN_NOTE_LIMITS.premium)).toBe("premium_only");
    expect(lengthStatus(LINKEDIN_NOTE_LIMITS.premium + 1)).toBe("too_long");
    expect(lengthStatus(0)).toBe("empty");
  });

  it("keeps LinkedIn's free limit and Nora's cap in step", () => {
    // If either moves, the page's wording about them has to be reread.
    expect(LINKEDIN_NOTE_LIMITS.free).toBe(INVITE_NOTE_MAX_CHARS);
  });

  it("flags a link with the sender's own containsLink, not a copy of it", () => {
    for (const text of [
      "Saw your talk, slides here https://example.com/x",
      "More at www.example.com/demo",
      "Hi {{cta_link}}",
      "Hi Sam, enjoyed your post on hiring.",
      "",
    ]) {
      expect(checkNote(text).hasLink).toBe(containsLink(text));
    }
    expect(checkNote("see https://example.com").hasLink).toBe(true);
    expect(checkNote("Hi Sam, enjoyed your post.").hasLink).toBe(false);
  });

  it("reports a bare domain only when there is no full link already", () => {
    expect(ids("Have a look at acme.io/demo")).toContain("domain");
    expect(ids("Have a look at https://acme.io/demo")).not.toContain("domain");
  });

  it("finds the pitch patterns", () => {
    expect(ids("We help agencies scale outbound.")).toContain("we_help");
    expect(ids("Could we book a quick call next week?")).toContain("meeting_ask");
    expect(ids("Open to a 15-minute chat?")).toContain("meeting_ask");
    expect(ids("Our platform automates this.")).toContain("our_product");
    expect(ids("with our AI platform")).toContain("our_product");
    expect(ids("Now $49 a seat")).toContain("price");
    expect(ids("20% off this month")).toContain("price");
    expect(ids("Is there a free trial?")).toContain("price");
    expect(ids("Hi {{first_name}}, saw your post")).toContain("placeholder");
    expect(ids("Hi [Name], saw your post")).toContain("placeholder");
  });

  it("counts questions and flags more than one", () => {
    expect(ids("How did the launch go?")).not.toContain("questions");
    const found = pitchFindings("How did the launch go? Are you hiring? Who runs sales?");
    expect(found.find((f) => f.id === "questions")?.label).toBe("3 questions");
  });

  it("leaves a plain, specific note alone", () => {
    const note =
      "Hi Priya, your post on moving the onboarding team to async standups was the clearest take I have read on it. Would be glad to connect.";
    expect(checkNote(note)).toMatchObject({ status: "fits", hasLink: false, findings: [] });
  });

  it("reports what it matched, once each, as written", () => {
    const found = pitchFindings("We help teams. We help founders.");
    expect(found[0]).toMatchObject({ id: "we_help", matched: ["We help"] });
  });
});
