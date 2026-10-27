/*
 * A company's own colours, for the graphic published with each post
 * (migration 0060).
 *
 * The graphic sits on a real professional's profile beside their company's
 * name, so it is drawn in that company's brand rather than ours. The colours
 * are read from the website Sage already reads, kept as hex codes on the
 * workspace, and editable on Profile → Company. Text on them is chosen by
 * contrast, never by taste: a brand's yellow under white type is unreadable,
 * and a picture nobody can read is worse than none.
 */

export interface BrandColors {
  primary: string | null;
  accent: string | null;
}

/** `#abc`, `abc`, `#AABBCC` → `#AABBCC`; anything else → null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : null;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const GRAPHIC_INK = "#10131F";
export const GRAPHIC_WHITE = "#FFFFFF";

/** White or ink, whichever reads better on this ground. */
export function readableOn(ground: string): string {
  return contrast(ground, GRAPHIC_WHITE) >= contrast(ground, GRAPHIC_INK) ? GRAPHIC_WHITE : GRAPHIC_INK;
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/**
 * A colour that says nothing about a brand: white, black, or a grey. Every
 * website is mostly these, so counting them would hand every company the same
 * off-white.
 */
export function isNeutral(hex: string): boolean {
  const { s, l } = hsl(hex);
  return s < 0.18 || l > 0.94 || l < 0.08;
}

function hueGap(a: string, b: string): number {
  const d = Math.abs(hsl(a).h - hsl(b).h);
  return Math.min(d, 360 - d);
}

/**
 * The brand colours a website declares, or null when it declares none we can
 * tell from its greys.
 *
 * What a site says about itself on purpose outranks what it merely uses: the
 * `theme-color` it gives phones, then custom properties named for the brand
 * (`--primary`, `--brand-color`, `--accent`), then how often a colour appears
 * across its styles. The accent is the next colour that is a different hue,
 * never a lighter shade of the primary.
 */
export function brandColorsFromHtml(html: string, stylesheets: readonly string[] = []): BrandColors | null {
  const score = new Map<string, number>();
  const add = (value: string | null | undefined, weight: number) => {
    const hex = normalizeHex(value);
    if (!hex || isNeutral(hex)) return;
    score.set(hex, (score.get(hex) ?? 0) + weight);
  };
  let namedAccent: string | null = null;

  for (const match of html.matchAll(/<meta[^>]+name=["'](theme-color|msapplication-TileColor)["'][^>]*>/gi)) {
    const content = /content=["']([^"']+)["']/i.exec(match[0])?.[1];
    add(content, match[1]!.toLowerCase() === "theme-color" ? 40 : 25);
  }

  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "").join("\n") +
    "\n" +
    [...html.matchAll(/style=["']([^"']*)["']/gi)].map((m) => m[1] ?? "").join("\n") +
    "\n" +
    stylesheets.join("\n");

  for (const match of css.matchAll(/--([\w-]*(?:primary|brand|accent|main|secondary)[\w-]*)\s*:\s*(#[0-9a-f]{3,6})\b/gi)) {
    const name = match[1]!.toLowerCase();
    const hex = normalizeHex(match[2]);
    if (!hex || isNeutral(hex)) continue;
    if (/accent|secondary/.test(name)) {
      namedAccent ??= hex;
      add(hex, 8);
    } else {
      add(hex, 30);
    }
  }
  for (const match of css.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) add(match[0], 1);

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const primary = ranked[0];
  if (!primary) return null;
  const accent =
    (namedAccent && namedAccent !== primary && hueGap(namedAccent, primary) >= 25 ? namedAccent : null) ??
    ranked.find((hex) => hex !== primary && hueGap(hex, primary) >= 25) ??
    null;
  return { primary, accent };
}

/** What a graphic is painted with. */
export interface GraphicPalette {
  ground: string;
  text: string;
  muted: string;
  accent: string;
}

/** The neutral palette for a workspace with no colours yet. */
export const NEUTRAL_BRAND = "#1F3A5F";

/**
 * The colours one style paints with, from the company's own.
 *
 * `brand` is the company's main colour as the ground. `light` is a white card
 * with the brand in the rule and the name. `dark` is ink with the brand as its
 * accent. Every text colour is picked by contrast against its own ground, and
 * an accent that would vanish into the ground falls back to the text colour.
 */
export function graphicPalette(colors: BrandColors, style: "brand" | "light" | "dark"): GraphicPalette {
  const primary = normalizeHex(colors.primary) ?? NEUTRAL_BRAND;
  const accent = normalizeHex(colors.accent);
  const visible = (candidate: string | null, ground: string, fallback: string) =>
    candidate && contrast(candidate, ground) >= 2 ? candidate : fallback;

  if (style === "light") {
    const ground = "#F7F8FA";
    return { ground, text: GRAPHIC_INK, muted: "#4A5163", accent: visible(primary, ground, GRAPHIC_INK) };
  }
  if (style === "dark") {
    const ground = GRAPHIC_INK;
    return {
      ground,
      text: GRAPHIC_WHITE,
      muted: "#B4BAC8",
      accent: visible(primary, ground, visible(accent, ground, GRAPHIC_WHITE)),
    };
  }
  // White type on the brand's colour, as a brand's own cards almost always
  // are, unless the colour is genuinely light (a yellow, a pale mint), where
  // only ink reads. A mid-tone (a bright blue, a pink) is deepened toward ink,
  // keeping its hue, just until white reads on it at body-text contrast.
  let ground = primary;
  let text = contrast(GRAPHIC_WHITE, primary) >= 3 ? GRAPHIC_WHITE : readableOn(primary);
  for (let step = 1; text === GRAPHIC_WHITE && contrast(text, ground) < 4.5 && step <= 10; step++) {
    ground = mix(primary, GRAPHIC_INK, step / 10);
  }
  if (contrast(text, ground) < 4.5) text = readableOn(ground);
  return {
    ground,
    text,
    muted: text === GRAPHIC_WHITE ? "rgba(255,255,255,0.78)" : "rgba(16,19,31,0.72)",
    accent: visible(accent, ground, text),
  };
}

/** `a` moved toward `b` by `amount` (0 to 1), channel by channel. */
function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const channel = (x: number, y: number) => Math.round(x + (y - x) * amount).toString(16).padStart(2, "0");
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`.toUpperCase();
}
