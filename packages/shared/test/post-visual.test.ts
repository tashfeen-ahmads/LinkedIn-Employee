import { describe, expect, it } from "vitest";
import {
  readVisual,
  visualFromLines,
  visualProblems,
  visualSpec,
  visualToLines,
  type PostVisual,
} from "../src/post-visual.js";
import { postProblems } from "../src/posts.js";

/*
 * The picture published with a post shows what the post says (rule 69). These
 * hold it to the post's own words: no number the post does not state, nothing
 * a reader could not have read in the post itself, and the shape each kind of
 * picture needs to be drawn.
 */

const BODY = "41% of calls to local trades come in after five. Reply inside ten minutes. Ask one question. Offer two times.";

const visual = (over: Partial<PostVisual>): PostVisual => ({
  kind: "steps",
  title: "Answer a lead before lunch",
  items: [
    { label: "Reply inside ten minutes", detail: null },
    { label: "Ask one question", detail: "What is broken" },
    { label: "Offer two times", detail: null },
  ],
  stat: null,
  columns: null,
  ...over,
});

describe("visualProblems", () => {
  it("passes a picture drawn from the post", () => {
    expect(visualProblems(visual({}), BODY)).toEqual([]);
    expect(
      visualProblems(visual({ kind: "stat", items: [], stat: { value: "41%", caption: "of calls come in after five" } }), BODY),
    ).toEqual([]);
  });

  it("refuses a number the post never states", () => {
    const problems = visualProblems(visual({ kind: "stat", items: [], stat: { value: "73%", caption: "of calls" } }), BODY);
    expect(problems.join(" ")).toMatch(/73.*which the post does not say/);
    expect(visualProblems(visual({ title: "3x more jobs" }), BODY).join(" ")).toMatch(/3/);
  });

  it("refuses dashes, emoji, hashtags, links and placeholders", () => {
    expect(visualProblems(visual({ title: "Reply fast — always" }), BODY).join(" ")).toMatch(/dash/);
    expect(visualProblems(visual({ title: "Reply fast 🚀" }), BODY).join(" ")).toMatch(/emoji/);
    expect(visualProblems(visual({ title: "Reply fast #plumbing" }), BODY).join(" ")).toMatch(/hashtag/);
    expect(visualProblems(visual({ title: "See acme.com" }), BODY).join(" ")).toMatch(/link/);
    expect(visualProblems(visual({ title: "Hi {{first_name}}" }), BODY).join(" ")).toMatch(/placeholder/);
  });

  it("holds each kind to the shape it is drawn in", () => {
    expect(visualProblems(visual({ items: visual({}).items.slice(0, 2) }), BODY).join(" ")).toMatch(/3 to 5/);
    expect(visualProblems(visual({ kind: "stat", items: [], stat: null }), BODY).join(" ")).toMatch(/number/);
    expect(
      visualProblems(visual({ kind: "compare", items: [], columns: [{ heading: "Myth", points: ["a", "b"] }] }), BODY).join(" "),
    ).toMatch(/two sides/);
    expect(visualProblems(visual({ items: [{ label: "x".repeat(49), detail: null }, ...visual({}).items] }), BODY).join(" ")).toMatch(
      /48/,
    );
  });
});

describe("visual lines", () => {
  it("round-trips every kind through the edit box", () => {
    const cases: PostVisual[] = [
      visual({}),
      visual({ kind: "checklist" }),
      visual({
        kind: "compare",
        items: [],
        columns: [
          { heading: "Myth", points: ["Hire more staff", "Voicemail works"] },
          { heading: "Fact", points: ["Most misses are at lunch", "Few leave a message"] },
        ],
      }),
      visual({ kind: "stat", items: [], stat: { value: "41%", caption: "of calls come in after five" } }),
      visual({ kind: "quote", items: [] }),
    ];
    for (const original of cases) {
      const back = visualFromLines(original.kind, original.title, visualToLines(original));
      expect(back).toEqual({ ...original, columns: original.columns ?? null });
    }
  });

  it("reads a stored picture leniently, and a headline alone as its key line", () => {
    const stored = visual({});
    expect(readVisual(stored.title, visualSpec(stored))).toEqual(stored);
    expect(readVisual("Reply first", null)).toMatchObject({ kind: "quote", title: "Reply first" });
    expect(readVisual("Reply first", { kind: "spiral" })).toBeNull();
    expect(readVisual("", visualSpec(stored))).toBeNull();
  });
});

describe("postProblems", () => {
  it("passes useful content and refuses an advert", () => {
    expect(postProblems("Most missed calls happen at lunch.\n\nMove the break by thirty minutes.")).toEqual([]);
    for (const pitch of [
      "We help plumbers answer every call.",
      "Our clients never miss a lead.",
      "Book a call to see how.",
      "DM me for the checklist.",
      "Link in the comments.",
    ]) {
      expect(postProblems(pitch), pitch).not.toEqual([]);
    }
    expect(postProblems("Three things to check 🚀").join(" ")).toMatch(/emoji/);
    expect(postProblems("Reply fast — always").join(" ")).toMatch(/dash/);
  });
});
