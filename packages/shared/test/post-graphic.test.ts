import { describe, expect, it } from "vitest";
import {
  GRAPHIC_INK,
  GRAPHIC_WHITE,
  brandColorsFromHtml,
  contrast,
  graphicPalette,
  normalizeHex,
  readableOn,
} from "../src/brand-colors.js";
import { fallbackGraphicHeadline, graphicHeadlineProblems } from "../src/posts.js";

describe("a company's colours, read from its website", () => {
  it("takes the colour the site gives phones over the colours it merely uses", () => {
    const html = `<meta name="theme-color" content="#0a7cff"><style>a{color:#e4572e} b{color:#e4572e}</style>`;
    expect(brandColorsFromHtml(html)?.primary).toBe("#0A7CFF");
  });

  it("reads brand custom properties, primary and accent apart", () => {
    const css = ":root{--brand-primary:#1b5e20;--accent-color:#ff9800;--text:#222222}";
    expect(brandColorsFromHtml("<html></html>", [css])).toEqual({ primary: "#1B5E20", accent: "#FF9800" });
  });

  it("never counts white, black or grey as a brand", () => {
    const css = "body{color:#111111;background:#ffffff} .x{border:#cccccc} .y{color:#d32f2f}";
    expect(brandColorsFromHtml("", [css])).toEqual({ primary: "#D32F2F", accent: null });
    expect(brandColorsFromHtml("<style>body{color:#000;background:#fff}</style>")).toBeNull();
  });

  it("never takes a lighter shade of the primary as the accent", () => {
    const css = ".a{color:#1565c0}.b{color:#1565c0}.c{color:#1e88e5}.d{color:#f9a825}";
    expect(brandColorsFromHtml("", [css])).toEqual({ primary: "#1565C0", accent: "#F9A825" });
  });

  it("normalises the codes people type", () => {
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex(" #0a7cff ")).toBe("#0A7CFF");
    expect(normalizeHex("blue")).toBeNull();
  });
});

describe("the graphic's colours", () => {
  it("puts readable text on the brand's own colour, light or dark", () => {
    expect(readableOn("#FFD600")).toBe(GRAPHIC_INK);
    expect(readableOn("#0D47A1")).toBe(GRAPHIC_WHITE);
    for (const primary of ["#FFD600", "#0D47A1", "#00C853", "#E91E63", "#795548"]) {
      for (const style of ["brand", "light", "dark"] as const) {
        const palette = graphicPalette({ primary, accent: null }, style);
        expect(contrast(palette.text, palette.ground), `${primary} ${style}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.accent, palette.ground), `${primary} ${style} accent`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("uses the company's colour, and a plain one only when it has none", () => {
    expect(graphicPalette({ primary: "#1B5E20", accent: null }, "brand").ground).toBe("#1B5E20");
    // A bright blue keeps white type, deepened just enough to read.
    const blue = graphicPalette({ primary: "#0A7CFF", accent: null }, "brand");
    expect(blue.text).toBe(GRAPHIC_WHITE);
    expect(contrast(blue.text, blue.ground)).toBeGreaterThanOrEqual(4.5);
    // A yellow keeps its own colour and takes ink.
    expect(graphicPalette({ primary: "#FFD600", accent: null }, "brand")).toMatchObject({ ground: "#FFD600", text: GRAPHIC_INK });
    expect(graphicPalette({ primary: "#0A7CFF", accent: null }, "light").accent).toBe("#0A7CFF");
    expect(graphicPalette({ primary: null, accent: null }, "brand").ground).toBe("#1F3A5F");
  });

  it("deepens a mid-tone brand colour just enough for white text, keeping its hue", () => {
    const palette = graphicPalette({ primary: "#E91E63", accent: null }, "brand");
    expect(palette.ground).not.toBe("#E91E63");
    expect(palette.text).toBe(GRAPHIC_WHITE);
    expect(contrast(palette.text, palette.ground)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the graphic's headline", () => {
  it("is short, and carries no link, hashtag, emoji or placeholder", () => {
    expect(graphicHeadlineProblems("Most missed calls happen after five")).toEqual([]);
    expect(graphicHeadlineProblems("x".repeat(91)).join(" ")).toMatch(/90/);
    expect(graphicHeadlineProblems("See acme.com").join(" ")).toMatch(/link/);
    expect(graphicHeadlineProblems("Missed calls #sales").join(" ")).toMatch(/hashtag/);
    expect(graphicHeadlineProblems("Missed calls 🚀").join(" ")).toMatch(/emoji/);
    expect(graphicHeadlineProblems("Hi {{first_name}}").join(" ")).toMatch(/placeholder/);
  });

  it("falls back to a short first sentence, and never cuts a long one", () => {
    expect(fallbackGraphicHeadline("Most missed calls happen after five. Here is why.")).toBe(
      "Most missed calls happen after five.",
    );
    expect(fallbackGraphicHeadline(`${"word ".repeat(30)}end.`)).toBeNull();
  });
});
