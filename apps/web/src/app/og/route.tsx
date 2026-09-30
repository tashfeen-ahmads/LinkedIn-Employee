import { ImageResponse } from "next/og";
import { BRAND } from "@le/shared";
import { MARK } from "@/components/logo";
import { SITE } from "@/lib/site";

export const runtime = "edge";

/**
 * The link preview card, drawn per page rather than one image for the whole
 * site. A shared link is often the first thing anyone sees of a product, and a
 * generic card wastes the one impression it gets.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get("title") ?? SITE.tagline).slice(0, 90);

  return new ImageResponse(
    (
      <div
        style={{ height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B0D12",
          padding: "72px",
          // A single wash of the accent, bottom-left, so the card is not a
          // flat rectangle of one colour.
          backgroundImage: "radial-gradient(circle at 0% 100%, #241F5E 0%, #0B0D12 55%)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/*
            The real mark, not a rounded rectangle standing in for one. This
            card is often the first thing anybody sees of the product, and a
            placeholder where the logo goes is a worse impression than no card.
            Drawn on its own plate so it reads on this dark ground exactly as
            it does on the header's light one.
          */}
          <svg width="44" height="44" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx={MARK.plateRadius} fill={BRAND.color.accent} />
            <path d={MARK.letter} stroke="#FFFFFF" strokeWidth={MARK.stroke} strokeLinecap="round" />
            <rect {...MARK.limit} fill={BRAND.color.limit} />
          </svg>
          <div style={{ color: "#ECEEF3", fontSize: 26, letterSpacing: "-0.02em" }}>{SITE.name}</div>
        </div>

        <div
          style={{ color: "#FFFFFF",
            fontSize: title.length > 55 ? 60 : 74,
            lineHeight: 1.08,
            letterSpacing: "-0.035em",
            maxWidth: 940,
            display: "flex" }}
        >
          {title}
        </div>

        <div style={{ color: "#A2AAB9", fontSize: 24, display: "flex" }}>
          {BRAND.promise}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
