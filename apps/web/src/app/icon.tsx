import { ImageResponse } from "next/og";
import { BRAND } from "@le/shared";
import { MARK } from "@/components/logo";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * The same mark as the header, so a browser tab matches the page it opened.
 *
 * Drawn from `MARK` rather than retyped, and coloured from `BRAND.color`,
 * because Satori resolves neither a React component from this app nor a CSS
 * custom property. Both are checked against the stylesheet by
 * `apps/web/test/brand-tokens.test.ts`.
 *
 * Drawn with its start ring at 32: a favicon is rendered once at that size and
 * scaled down by the browser with filtering, so the ring survives as a soft
 * foot to the stem rather than a smudge.
 */
export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect
          width="32"
          height="32"
          rx={MARK.plateRadius}
          fill={BRAND.color.accent}
        />
        <path
          d={MARK.letter}
          stroke="#FFFFFF"
          strokeWidth={MARK.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={MARK.start.cx}
          cy={MARK.start.cy}
          r={MARK.start.r}
          stroke="#FFFFFF"
          strokeWidth={MARK.start.stroke}
        />
        <circle
          cx={MARK.goal.cx}
          cy={MARK.goal.cy}
          r={MARK.goal.r}
          fill={BRAND.color.goal}
        />
      </svg>
    </div>,
    size,
  );
}
