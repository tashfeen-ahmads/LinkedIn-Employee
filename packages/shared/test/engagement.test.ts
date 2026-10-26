import { describe, expect, it } from "vitest";
import { choosePost, commentProblems, sensitivePost, worthCommentingOn } from "../src/engagement.js";

const NOW = new Date("2026-09-09T14:00:00Z");
const POST =
  "We moved our dispatch team to a four-day week last spring and missed calls dropped by a third. Still working out how to cover Friday afternoons without burning anyone out.";
const base = { socialId: "a", text: POST, postedAt: "2026-09-07T10:00:00Z", isRepost: false, canReact: true, canComment: true };

describe("choosing a post", () => {
  it("takes their own recent words and nothing else", () => {
    expect(choosePost([{ ...base, isRepost: true }, { ...base, socialId: "b" }], NOW)?.socialId).toBe("b");
    expect(choosePost([{ ...base, postedAt: "2026-07-01T00:00:00Z" }], NOW)).toBeNull();
    expect(choosePost([{ ...base, canReact: false }], NOW)).toBeNull();
    expect(choosePost([{ ...base, postedAt: null }], NOW)).toBeNull();
  });

  it("never touches grief, illness, a lost job or politics", () => {
    for (const text of ["My mother passed away on Sunday.", "Laid off today after nine years.", "Go vote on Tuesday."]) {
      expect(sensitivePost(text), text).toBe(true);
      expect(choosePost([{ ...base, text }], NOW), text).toBeNull();
    }
  });

  it("comments only where the post says enough to respond to", () => {
    expect(worthCommentingOn(base)).toBe(true);
    expect(worthCommentingOn({ ...base, text: "Big week. More soon." })).toBe(false);
    expect(worthCommentingOn({ ...base, canComment: false })).toBe(false);
  });
});

describe("a comment", () => {
  const input = { postText: POST, grounding: "cover Friday afternoons", companyName: "Acme Answering" };

  it("passes when it responds to something they actually wrote", () => {
    expect(commentProblems("Fridays were our gap too. We ended up rotating one person on a half day.", input)).toEqual([]);
  });

  it("is refused when it responds to nothing in particular", () => {
    expect(commentProblems("Fridays are always hard.", { ...input, grounding: "" }).join(" ")).toMatch(/specific/);
    expect(commentProblems("Fridays are always hard.", { ...input, grounding: "a phrase they never wrote" }).join(" ")).toMatch(
      /specific/,
    );
  });

  it("is refused for the praise every bot writes", () => {
    expect(commentProblems("Great post, thanks for sharing.", input).join(" ")).toMatch(/great post/);
  });

  it("is refused for a link, the company's name, or an invitation to talk", () => {
    expect(commentProblems("Fridays were our gap too, see acme.com/fridays.", input).join(" ")).toMatch(/link/);
    expect(commentProblems("At Acme Answering we cover Fridays for teams like yours.", input).join(" ")).toMatch(/company/);
    expect(commentProblems("Fridays were our gap too. Let's chat about it.", input).join(" ")).toMatch(/talk or meet/);
  });
});
