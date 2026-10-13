import { describe, expect, it } from "vitest";
import { INVITE_NOTE_MAX_CHARS, containsLink } from "@le/shared";
import {
  TEMPLATE_GROUPS,
  TEMPLATE_HEADROOM,
  allTemplates,
  noteLength,
  templateText,
} from "../src/components/seo/guide2-templates";

/**
 * The templates page teaches people what to send. A template over the limit is
 * an invitation LinkedIn refuses, and one carrying a link is the note this
 * product itself drops to no note at all (CLAUDE.md rule 29). The page prints
 * each count from the same function, so this is the check that what it prints
 * is true.
 */
describe("connection request templates", () => {
  const templates = allTemplates();

  it("offers twelve to twenty templates across several situations", () => {
    expect(templates.length).toBeGreaterThanOrEqual(12);
    expect(templates.length).toBeLessThanOrEqual(20);
    expect(TEMPLATE_GROUPS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  });

  it.each(templates.map((t) => [t.id, templateText(t)] as const))(
    "%s fits under the invite note limit with room for a longer name",
    (_id, text) => {
      expect(noteLength(text)).toBeLessThanOrEqual(INVITE_NOTE_MAX_CHARS);
      expect(noteLength(text) + TEMPLATE_HEADROOM).toBeLessThanOrEqual(INVITE_NOTE_MAX_CHARS);
    },
  );

  it.each(templates.map((t) => [t.id, templateText(t)] as const))("%s carries no link", (_id, text) => {
    expect(containsLink(text)).toBe(false);
  });

  it("every template has something to swap, and no dashes the brief bans", () => {
    for (const t of templates) {
      expect(t.parts.some((p) => typeof p !== "string"), t.id).toBe(true);
      expect(templateText(t), t.id).not.toMatch(/[–—]/);
    }
  });

  it("would catch a template that broke the rules", () => {
    // The check above is only worth something if it bites.
    expect(containsLink("Hi Sam, details at https://example.com")).toBe(true);
    expect(noteLength("x".repeat(INVITE_NOTE_MAX_CHARS + 1))).toBeGreaterThan(INVITE_NOTE_MAX_CHARS);
  });
});
