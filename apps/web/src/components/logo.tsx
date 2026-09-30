import { BRAND } from "@le/shared";

/**
 * The mark is the funnel: three bars narrowing, and the last one — the meeting
 * — in the second hue, because that is the only stage that is a different kind
 * of thing from the ones above it.
 *
 * Drawn rather than lettered so it survives at 20px in a browser tab, and built
 * from the same tokens as everything else so it cannot drift from the palette.
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
      <rect width="32" height="32" rx="9" className="logo-plate" />
      <rect x="8" y="9.5" width="16" height="3" rx="1.5" className="logo-bar" />
      <rect x="10" y="14.5" width="12" height="3" rx="1.5" className="logo-bar is-mid" />
      <rect x="12.5" y="19.5" width="7" height="3" rx="1.5" className="logo-bar is-outcome" />
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
const QUALIFIER = BRAND.full.startsWith(BRAND.name) ? BRAND.full.slice(BRAND.name.length).trim() : "";

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wordmark-text">
        {BRAND.name}
        {QUALIFIER ? <span className="wordmark-thin">&nbsp;{QUALIFIER}</span> : null}
      </span>
    </span>
  );
}
