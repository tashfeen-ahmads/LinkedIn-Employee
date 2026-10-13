import { BRAND } from "@le/shared";

/**
 * The mark's geometry, in one place.
 *
 * The favicon and the link-preview card have to redraw it, they render
 * through Satori, which cannot run a React component from this app or resolve
 * a class name, so without this the same letter would be typed out in three
 * files and would fall out of step in two of them.
 */
export const MARK = {
  /** One stroke: up from you, across to them, up to the meeting. */
  letter: "M10 20.6V8.8L22 21.6V11.8",
  /** The same stroke where the start ring is dropped: the stem reaches down instead. */
  letterSmall: "M10 23.4V8.8L22 21.6V11.8",
  stroke: 3.2,
  plateRadius: 9,
  /** Where the path starts: a hollow ring, the rep before anyone is contacted. */
  start: { cx: 10, cy: 23.6, r: 2.2, stroke: 1.8 },
  /** Where the path arrives: the second hue, the booked meeting. */
  goal: { cx: 22, cy: 8.6, r: 2.9 },
  /** Below this the start ring is dropped; see above. */
  detailMinSize: 20,
} as const;

/**
 * The mark is an N drawn as the route a conversation takes.
 *
 * Every product in this category draws a funnel or a rocket, and both say the
 * same thing: more, faster. What Nora does is narrower and more careful: it
 * starts from one person, crosses to exactly one other person with a note
 * written for them, and keeps going until there is a meeting. So the letter is
 * one unbroken stroke with a start and an end. A hollow ring at the foot of
 * the left stem is the rep, before anyone has been contacted; the stem rises,
 * the diagonal crosses to the other side, the person on the other end; the
 * right stem rises again and arrives at a solid dot in the second hue, which
 * is the booked call. Read left to right it is the initial of the name; read
 * as a line it is the product's whole job, one controlled path from you to a
 * meeting, never a spray.
 *
 * Drawn from one stroke weight so it survives a browser tab. Below 20px the
 * start ring is dropped and the stem reaches down instead: at that size a ring
 * is a white smudge, and a detail nobody can resolve is worse than one that is
 * not there. The arrival dot stays at every size, because it is the point.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  const detailed = size >= MARK.detailMinSize;
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
      <path
        d={detailed ? MARK.letter : MARK.letterSmall}
        strokeWidth={MARK.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="logo-stroke"
      />
      {detailed ? (
        <circle
          cx={MARK.start.cx}
          cy={MARK.start.cy}
          r={MARK.start.r}
          strokeWidth={MARK.start.stroke}
          className="logo-stroke"
        />
      ) : null}
      <circle {...MARK.goal} className="logo-goal" />
    </svg>
  );
}

/**
 * What the app's sidebar sets in a quieter weight after the name.
 *
 * Sliced off `BRAND.full` rather than retyped, so a rename cannot leave half
 * the old name behind.
 */
export const BRAND_QUALIFIER = BRAND.full.startsWith(BRAND.name)
  ? BRAND.full.slice(BRAND.name.length).trim()
  : "";

/**
 * The public lockup: the mark and the name, and nothing after it.
 *
 * It used to read "Nora SDR" on a laptop and "Nora" on a phone, because the
 * header hid the qualifier below 480px. One product with two names depending
 * on the width of the screen is two products to somebody comparing
 * screenshots, so the site writes the name the way the copy does, everywhere.
 */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wordmark-text">{BRAND.name}</span>
    </span>
  );
}
