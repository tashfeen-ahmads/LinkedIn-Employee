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
 * The line is kept at this size even though the component drops it below 20px:
 * a favicon is rendered once at 32 and scaled by the browser with filtering,
 * so it survives as a tint rather than becoming a smudge.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx={MARK.plateRadius} fill={BRAND.color.accent} />
          <path d={MARK.letter} stroke="#FFFFFF" strokeWidth={MARK.stroke} strokeLinecap="round" />
          <rect {...MARK.limit} fill={BRAND.color.limit} />
        </svg>
      </div>
    ),
    size,
  );
}
