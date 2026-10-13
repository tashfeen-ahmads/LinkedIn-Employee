import { ImageResponse } from "next/og";
import { BRAND } from "@le/shared";
import { MARK } from "@/components/logo";
import { SITE } from "@/lib/site";
import { CONTENT, type ContentKind, type TeamKey } from "@/lib/seo-content";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/*
 * Drawn once per article at build time and served as a static file, then
 * resized and re-encoded by the image optimizer for each screen. Drawing it on
 * every request made it the slowest thing on the page, and the first thing
 * anybody sees under the headline.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return CONTENT.map((page) => ({ slug: page.path.slice(1).split("/") }));
}

/**
 * The feature image for one article: its header picture, its link preview and
 * its structured-data image, all the same drawing.
 *
 * Drawn rather than generated, so forty articles look like one publication:
 * the site's own ground and type, the title as the subject, the teammate who
 * owns the topic in their own colour, and one motif per kind of page that
 * says what the page is before a word is read. A stock photo of a laptop says
 * nothing, and an AI picture per article drifts into forty different styles.
 *
 * Colours are literals here because an image has no stylesheet; they are the
 * light-mode values of the tokens in globals.css.
 */
const INK = "#10131F";
const MUTED = "#454D5E";
const GROUND = "#F4F5F9";
const CARD = "#FFFFFF";
const LINE = "#E3E6EE";

const OWNER: Record<TeamKey, { name: string; role: string; colour: string }> = {
  sage: { name: "Sage", role: "Strategist", colour: "#0B7A66" },
  scout: { name: "Scout", role: "Prospector", colour: "#9E520A" },
  quinn: { name: "Quinn", role: "Campaign writer", colour: "#7A3CCB" },
  reese: { name: "Reese", role: "Outreach and booking", colour: "#B42D5E" },
};

const KIND_LABEL: Record<ContentKind, string> = {
  guide: "Guide",
  alternative: "Comparison",
  tool: "Free tool",
  audience: "Use case",
  landing: "Free plan",
};

/*
 * Geist, the site's own face (SIL Open Font License), in src/assets/fonts.
 * Without it the renderer falls back to one regular weight, and a 600-weight
 * headline comes out thin and generic.
 */
const FONTS = join(process.cwd(), "src/assets/fonts");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  const path = `/${slug.join("/")}`;
  const [regular, semibold] = await Promise.all([
    readFile(join(FONTS, "Geist-Regular.ttf")),
    readFile(join(FONTS, "Geist-SemiBold.ttf")),
  ]);
  const page = CONTENT.find((p) => p.path === path);
  const title = (page?.title ?? SITE.tagline).slice(0, 110);
  const owner = OWNER[page?.owner ?? "reese"];
  const kind = page?.kind ?? "landing";

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        background: GROUND,
        padding: 64,
        gap: 48,
        fontFamily: "Geist",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
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
          <div
            style={{
              color: INK,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {SITE.name}
          </div>
          <div style={{ color: MUTED, fontSize: 22, marginLeft: 8 }}>
            {KIND_LABEL[kind]}
          </div>
        </div>
        <div
          style={{
            color: INK,
            fontSize: title.length > 80 ? 46 : title.length > 55 ? 54 : 62,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.035em",
            display: "flex",
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: owner.colour,
              color: "#FFFFFF",
              fontSize: 22,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {owner.name[0]}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: INK, fontSize: 22, fontWeight: 600 }}>
              {owner.name}
            </div>
            <div
              style={{ color: MUTED, fontSize: 18, display: "flex" }}
            >{`${owner.role} on Nora's team`}</div>
          </div>
        </div>
      </div>
      <div
        style={{
          width: 360,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: CARD,
          border: `1px solid ${LINE}`,
          borderRadius: 24,
          padding: 32,
        }}
      >
        <Motif
          kind={kind}
          owner={page?.owner ?? "reese"}
          accent={owner.colour}
        />
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}

/** One picture per kind of page, built from the shapes the product itself draws. */
function Motif({
  kind,
  owner,
  accent,
}: {
  kind: ContentKind;
  owner: TeamKey;
  accent: string;
}) {
  const teal = BRAND.color.goal;
  const indigo = BRAND.color.accent;

  // Limits, pacing and safety: the warm-up ramp, a day's allowance rising.
  if (owner === "reese" && kind !== "alternative") {
    const heights = [40, 58, 76, 94, 112, 130, 148, 166, 184, 200];
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          height: 220,
        }}
      >
        {heights.map((h, i) => (
          <div
            key={i}
            style={{
              width: 18,
              height: h,
              background: teal,
              opacity: 0.35 + i * 0.065,
              borderRadius: 4,
            }}
          />
        ))}
      </div>
    );
  }

  // Writing: a connection note, its lines and the facts it was written from.
  if (owner === "quinn") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: LINE,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                width: 120,
                height: 12,
                borderRadius: 6,
                background: INK,
              }}
            />
            <div
              style={{
                width: 90,
                height: 10,
                borderRadius: 5,
                background: LINE,
              }}
            />
          </div>
        </div>
        {[260, 240, 200].map((w, i) => (
          <div
            key={i}
            style={{
              width: w,
              height: 12,
              borderRadius: 6,
              background: i === 1 ? accent : LINE,
              opacity: i === 1 ? 0.55 : 1,
            }}
          />
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          {[70, 96, 80].map((w, i) => (
            <div
              key={i}
              style={{
                width: w,
                height: 22,
                borderRadius: 11,
                border: `2px solid ${indigo}`,
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // Comparisons: two columns, rows of checks.
  if (kind === "alternative") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          width: "100%",
        }}
      >
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            style={{ display: "flex", alignItems: "center", gap: 16 }}
          >
            <div
              style={{ flex: 1, height: 12, borderRadius: 6, background: LINE }}
            />
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                background: teal,
              }}
            />
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                border: `3px solid ${LINE}`,
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  // Finding people: a list of profiles, the top ones matched.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        width: "100%",
      }}
    >
      {[1, 0.85, 0.7, 0.45].map((o, i) => (
        <div
          key={i}
          style={{ display: "flex", alignItems: "center", gap: 12, opacity: o }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              background: i < 2 ? accent : LINE,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                width: 150 - i * 12,
                height: 11,
                borderRadius: 6,
                background: INK,
              }}
            />
            <div
              style={{
                width: 110 - i * 8,
                height: 9,
                borderRadius: 5,
                background: LINE,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
