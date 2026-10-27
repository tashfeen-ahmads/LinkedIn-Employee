import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { graphicPalette, readableOn, type BrandColors, type GraphicStyle } from "@le/shared";

/**
 * The graphic published with a post (migration 0060), in one definition: the
 * preview on the posts page and the picture stored at approval are this same
 * drawing, so what somebody approves is what goes out.
 *
 * In the company's own colours (`graphicPalette`), with the rep's name and the
 * company's under the headline, because it sits on a real professional's
 * profile and speaks for their business, not ours. No logo of ours anywhere
 * on it. Square, because a square image takes the most room LinkedIn gives a
 * picture in a phone's feed without being cropped.
 */
export const GRAPHIC_SIZE = 1200;

const FONTS = join(process.cwd(), "src/assets/fonts");

export interface PostGraphicInput {
  headline: string;
  style: GraphicStyle;
  colors: BrandColors;
  /** The rep, whose profile it appears on. */
  name: string;
  /** Their company, under the name. */
  company: string | null;
}

/** Larger for a short line, so every headline fills the card the same way. */
function headlineSize(text: string): number {
  const n = text.length;
  if (n <= 30) return 104;
  if (n <= 50) return 88;
  if (n <= 70) return 76;
  return 66;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "•"
  );
}

export async function drawPostGraphic(input: PostGraphicInput): Promise<ImageResponse> {
  const [regular, semibold] = await Promise.all([
    readFile(join(FONTS, "Geist-Regular.ttf")),
    readFile(join(FONTS, "Geist-SemiBold.ttf")),
  ]);
  const palette = graphicPalette(input.colors, input.style);
  const headline = input.headline.trim();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: palette.ground,
        padding: 96,
        fontFamily: "Geist",
        position: "relative",
      }}
    >
      {/* One quiet shape in the accent, so the card has a mark that is the
          company's colour and not a stock flourish. */}
      <div
        style={{
          position: "absolute",
          right: -220,
          bottom: -220,
          width: 640,
          height: 640,
          borderRadius: 640,
          border: `56px solid ${palette.accent}`,
          opacity: 0.16,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ width: 120, height: 12, borderRadius: 6, background: palette.accent }} />
        {input.company ? (
          <div style={{ color: palette.muted, fontSize: 30, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {input.company.slice(0, 48)}
          </div>
        ) : null}
      </div>

      <div
        style={{
          color: palette.text,
          fontSize: headlineSize(headline),
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: "-0.025em",
          maxWidth: 980,
          display: "flex",
        }}
      >
        {headline}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 76,
            background: palette.accent,
            color: readableOn(palette.accent),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 30,
            fontWeight: 600,
          }}
        >
          {initials(input.name)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ color: palette.text, fontSize: 34, fontWeight: 600 }}>{input.name.slice(0, 60)}</div>
          {input.company ? (
            <div style={{ color: palette.muted, fontSize: 28 }}>{input.company.slice(0, 60)}</div>
          ) : null}
        </div>
      </div>
    </div>,
    {
      width: GRAPHIC_SIZE,
      height: GRAPHIC_SIZE,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}

/**
 * What every graphic in a workspace is drawn with: the company's colours, the
 * rep's name and the company's. The company is the business profile's own
 * name, falling back to the workspace's, so a card is never signed by nobody.
 */
export async function loadGraphicContext(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase-server").createClient>>,
  session: { workspaceId: string; fullName: string | null },
): Promise<{ colors: BrandColors; name: string; company: string | null }> {
  const [{ data: ws }, { data: profiles }] = await Promise.all([
    supabase.from("workspaces").select("name, brand_primary, brand_accent").eq("id", session.workspaceId).maybeSingle(),
    supabase
      .from("business_profiles")
      .select("spec, created_at")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const spec = profiles?.[0]?.spec as { companyName?: unknown } | null | undefined;
  const company = typeof spec?.companyName === "string" && spec.companyName.trim() ? spec.companyName.trim() : ws?.name ?? null;
  return {
    colors: { primary: ws?.brand_primary ?? null, accent: ws?.brand_accent ?? null },
    name: session.fullName?.trim() || "Your name",
    company,
  };
}
