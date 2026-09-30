import { BRAND } from "@le/shared";

/**
 * The mark's geometry, in one place.
 *
 * The favicon and the link-preview card have to redraw it — they render
 * through Satori, which cannot run a React component from this app or resolve
 * a class name — so without this the same letter would be typed out in three
 * files and would fall out of step in two of them.
 */
export const MARK = {
  /** Left stem full height; shoulder arcs over to a right leg that stops early. */
  letter: "M9.4 25.2V11.4M9.4 15a6.6 6.6 0 0 1 12.8 2.3v4.3",
  stroke: 3.5,
  plateRadius: 9,
  limit: { x: 14.6, y: 26.4, width: 9.8, height: 1.8, rx: 0.9 },
  /** Below this the line is dropped; see above. */
  limitMinSize: 20,
} as const;

/**
 * The mark is a lowercase `n` whose right leg stops short of a line.
 *
 * Every product in this category draws a funnel or a rocket, and both say the
 * same thing: more, faster. This one's whole argument is the opposite. A third
 * of one competitor's reviewers report having their LinkedIn account restricted
 * inside ninety days, because a tool sent as much as it could as fast as it
 * could. What Nora sells is a ceiling — a daily cap that is a product rule and
 * not a setting, a ramp that starts at an account's first action, a day's
 * allowance spread across the day rather than fired off in an hour.
 *
 * So the letter approaches its limit and deliberately does not reach it, and
 * the limit is drawn. That is the entire pitch in one glyph, and it is the
 * initial of the name, which means the mark cannot be lifted by anyone whose
 * product does something else.
 *
 * Drawn from two strokes of one weight so it survives a browser tab. Below
 * 20px the line is dropped: at that size it is two pixels of teal that read as
 * a smudge under the letter rather than as a limit above it, and a detail
 * nobody can resolve is worse than one that is not there.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="logo-mark"
    >
      <rect width="32" height="32" rx={MARK.plateRadius} className="logo-plate" />
      <path d={MARK.letter} strokeWidth={MARK.stroke} strokeLinecap="round" className="logo-stroke" />
      {size >= MARK.limitMinSize ? <rect {...MARK.limit} className="logo-limit" /> : null}
    </svg>
  );
}

/**
 * The name carries the weight and its qualifier sits back, which is the shape
 * the type scale was already set for.
 *
 * Sliced off `BRAND.full` rather than retyped, because the wordmark is the one
 * place the name is broken in two for typesetting — and therefore the one
 * place a rename leaves half the old name behind, on the most looked-at
 * element in the product.
 */
export const BRAND_QUALIFIER = BRAND.full.startsWith(BRAND.name)
  ? BRAND.full.slice(BRAND.name.length).trim()
  : "";

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wordmark-text">
        {BRAND.name}
        {BRAND_QUALIFIER ? <span className="wordmark-thin">&nbsp;{BRAND_QUALIFIER}</span> : null}
      </span>
    </span>
  );
}
