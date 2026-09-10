import { ImageResponse } from "next/og";
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
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B0D12",
          padding: "72px",
          // A single wash of the accent, bottom-left, so the card is not a
          // flat rectangle of one colour.
          backgroundImage: "radial-gradient(circle at 0% 100%, #241F5E 0%, #0B0D12 55%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "#A5A0FF",
              display: "flex",
            }}
          />
          <div style={{ color: "#ECEEF3", fontSize: 26, letterSpacing: "-0.02em" }}>{SITE.name}</div>
        </div>

        <div
          style={{
            color: "#FFFFFF",
            fontSize: title.length > 55 ? 60 : 74,
            lineHeight: 1.08,
            letterSpacing: "-0.035em",
            maxWidth: 940,
            display: "flex",
          }}
        >
          {title}
        </div>

        <div style={{ color: "#A2AAB9", fontSize: 24, display: "flex" }}>
          Finds your buyers. Starts the conversation. Books the meeting.
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
