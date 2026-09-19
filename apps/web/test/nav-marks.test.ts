import { describe, expect, it } from "vitest";
import { markFor } from "../src/lib/nav-marks";

/**
 * The one mark in the sidebar.
 *
 * Twelve equally-weighted links is a list you read, not a nav you use. The dot
 * only works if there is exactly one of it: two marks and a newcomer is back to
 * guessing which section wants them.
 */
describe("markFor", () => {
  const LINKS: [string, string][] = [
    ["/app", "Overview"],
    ["/app/strategy", "Strategy"],
    ["/app/campaigns", "Campaigns"],
    ["/app/knowledge", "Knowledge"],
    ["/app/profile", "Your profile"],
    ["/app/team", "Team"],
    ["/app/support", "Support"],
  ];

  const marked = (marks: Parameters<typeof markFor>[2]) =>
    LINKS.map(([href, label]) => [href, markFor(href, label, marks)] as const).filter(
      ([, mark]) => mark.state,
    );

  it("marks exactly the step the workspace is on", () => {
    const marks = marked({ nextHref: "/app/knowledge", linkedInNeedsYou: false });
    expect(marks).toHaveLength(1);
    expect(marks[0][0]).toBe("/app/knowledge");
    expect(marks[0][1].state).toBe("next");
    expect(marks[0][1].stateLabel).toBe("Knowledge — your next step");
  });

  it("marks nothing at all once setup is finished", () => {
    expect(marked({ nextHref: null, linkedInNeedsYou: false })).toHaveLength(0);
  });

  it("points at your profile, and only there, while LinkedIn is disconnected", () => {
    // A next-step dot on Knowledge while the account cannot send points at the
    // wrong stage — and two dots point at neither.
    const marks = marked({ nextHref: "/app/knowledge", linkedInNeedsYou: true });
    expect(marks).toHaveLength(1);
    expect(marks[0][0]).toBe("/app/profile");
    expect(marks[0][1].state).toBe("attention");
    expect(marks[0][1].stateLabel).toBe("LinkedIn is not connected");
  });

  it("does not put a next-step dot on a broken profile link", () => {
    // Both rules fire on the same href; the broken one wins, because "connect
    // this" and "you are up to this" are not the same sentence.
    const mark = markFor("/app/profile", "Your profile", { nextHref: "/app/profile", linkedInNeedsYou: true });
    expect(mark.state).toBe("attention");
  });

  it("says out loud what a coloured dot means", () => {
    // The dot is aria-hidden. Without the label a screen-reader user gets
    // twelve identical links and no indication of which one wants them.
    for (const marks of [
      { nextHref: "/app/strategy", linkedInNeedsYou: false },
      { nextHref: null, linkedInNeedsYou: true },
    ]) {
      for (const [, mark] of marked(marks)) expect(mark.stateLabel).toBeTruthy();
    }
  });
});
