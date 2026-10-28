import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { graphicPalette, readableOn, type BrandColors, type GraphicStyle, type PostVisual } from "@le/shared";

/**
 * The picture published with a post (rule 69), in one definition: the preview
 * on the posts page and the picture stored at approval are this same drawing,
 * so what somebody approves is what goes out.
 *
 * It draws what the post says (`PostVisual`): numbered steps, two sides
 * compared, one number, a checklist, a chain of cause and effect, or the key
 * line framed. A headline on a block of colour said nothing the first line of
 * the post had not, and read as decoration. In the company's own colours
 * (`graphicPalette`); no name of the rep's and no mark of ours, because the
 * idea is the point and the post already says who wrote it.
 *
 * Portrait 4:5, because that is the most room LinkedIn gives a picture in a
 * phone's feed without cropping it, and a list needs the height.
 */
export const GRAPHIC_WIDTH = 1080;
export const GRAPHIC_HEIGHT = 1350;

const FONTS = join(process.cwd(), "src/assets/fonts");

/** What kind of post it is, said small above the title. */
const KICKER: Record<string, string> = {
  industry_update: "This week",
  how_to: "How to",
  myth_vs_fact: "Myth vs fact",
  checklist: "Checklist",
  insight: "Insight",
  story: "From the field",
};

export interface PostGraphicInput {
  visual: PostVisual;
  style: GraphicStyle;
  colors: BrandColors;
  /** The post's format (`linkedin_posts.format`), for the line above the title. */
  format?: string | null;
  /** The company, set small at the foot. */
  company?: string | null;
}

interface Paint {
  ground: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  surface: string;
  line: string;
}

function paint(colors: BrandColors, style: GraphicStyle): Paint {
  const palette = graphicPalette(colors, style);
  const light = palette.text !== "#FFFFFF";
  return {
    ...palette,
    onAccent: readableOn(palette.accent),
    surface: style === "light" ? "#FFFFFF" : light ? "rgba(16,19,31,0.06)" : "rgba(255,255,255,0.09)",
    line: light ? "rgba(16,19,31,0.14)" : "rgba(255,255,255,0.18)",
  };
}

/** Smaller type for a longer title, so every picture fills the same way. */
function titleSize(text: string, kind: PostVisual["kind"]): number {
  const n = text.length;
  if (kind === "quote") return n <= 50 ? 92 : n <= 80 ? 78 : 66;
  if (n <= 32) return 76;
  if (n <= 56) return 64;
  return 54;
}

function Check({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Cross({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M7 7l10 10M17 7L7 17" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

function ArrowDown({ color }: { color: string }) {
  return (
    <svg width={44} height={44} viewBox="0 0 24 24">
      <path d="M12 4v15M6 13l6 6 6-6" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Larger type for fewer lines, so a three-line picture fills like a five-line one. */
function lineSize(count: number): number {
  return count <= 3 ? 52 : count === 4 ? 46 : 40;
}

/** A label and its detail, the text half of every row. */
function Lines({ p, label, detail, size }: { p: Paint; label: string; detail: string | null; size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
      <div style={{ color: p.text, fontSize: size, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.01em" }}>{label}</div>
      {detail ? (
        <div style={{ color: p.muted, fontSize: Math.round(size * 0.68), lineHeight: 1.3 }}>{detail}</div>
      ) : null}
    </div>
  );
}

function Steps({ visual, p }: { visual: PostVisual; p: Paint }) {
  const size = lineSize(visual.items.length);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
      {visual.items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 36 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 84 }}>
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: 84,
                flexShrink: 0,
                background: p.accent,
                color: p.onAccent,
                fontSize: 40,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {String(i + 1)}
            </div>
            {i < visual.items.length - 1 ? <div style={{ width: 4, flex: 1, minHeight: 36, background: p.line }} /> : null}
          </div>
          <div style={{ display: "flex", flex: 1, paddingTop: 16, paddingBottom: i < visual.items.length - 1 ? (visual.items.length <= 3 ? 64 : 40) : 0 }}>
            <Lines p={p} label={item.label} detail={item.detail} size={size} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Checklist({ visual, p }: { visual: PostVisual; p: Paint }) {
  const size = lineSize(visual.items.length);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
      {visual.items.map((item, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 32,
            padding: "30px 0",
            borderTop: i === 0 ? "none" : `2px solid ${p.line}`,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: p.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Check color={p.onAccent} size={44} />
          </div>
          <div style={{ display: "flex", flex: 1, paddingTop: 6 }}>
            <Lines p={p} label={item.label} detail={item.detail} size={size} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Flow({ visual, p }: { visual: PostVisual; p: Paint }) {
  const last = visual.items.length - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", alignItems: "stretch" }}>
      {visual.items.map((item, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              width: "100%",
              padding: "30px 40px",
              borderRadius: 28,
              background: i === last ? p.accent : p.surface,
              border: i === last ? "none" : `2px solid ${p.line}`,
            }}
          >
            <Lines
              p={i === last ? { ...p, text: p.onAccent, muted: p.onAccent } : p}
              label={item.label}
              detail={item.detail}
              size={lineSize(visual.items.length) - 4}
            />
          </div>
          {i < last ? (
            <div style={{ display: "flex", padding: "10px 0" }}>
              <ArrowDown color={p.accent} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Compare({ visual, p }: { visual: PostVisual; p: Paint }) {
  const [before, after] = visual.columns ?? [];
  const column = (side: { heading: string; points: string[] } | undefined, good: boolean) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        padding: "40px 36px",
        borderRadius: 28,
        background: good ? p.surface : "transparent",
        border: `${good ? 4 : 2}px solid ${good ? p.accent : p.line}`,
        gap: 30,
      }}
    >
      <div
        style={{
          color: good ? p.accent : p.muted,
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {side?.heading ?? ""}
      </div>
      {(side?.points ?? []).map((point, i) => (
        <div key={i} style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          <div style={{ display: "flex", paddingTop: 4, flexShrink: 0 }}>
            {good ? <Check color={p.accent} size={40} /> : <Cross color={p.muted} size={40} />}
          </div>
          <div style={{ color: good ? p.text : p.muted, fontSize: 34, lineHeight: 1.25, flex: 1 }}>{point}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
      <div style={{ display: "flex", gap: 28, alignItems: "stretch" }}>
        {column(before, false)}
        {column(after, true)}
      </div>
    </div>
  );
}

function Stat({ visual, p }: { visual: PostVisual; p: Paint }) {
  const value = visual.stat?.value ?? "";
  const size = value.length <= 3 ? 340 : value.length <= 5 ? 260 : value.length <= 8 ? 190 : 150;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 28 }}>
      <div style={{ color: p.accent, fontSize: size, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.04em" }}>{value}</div>
      <div style={{ width: 140, height: 10, borderRadius: 5, background: p.accent }} />
      <div style={{ color: p.text, fontSize: 52, lineHeight: 1.2, maxWidth: 860 }}>{visual.stat?.caption ?? ""}</div>
    </div>
  );
}

function Quote({ visual, p }: { visual: PostVisual; p: Paint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 20 }}>
      <div style={{ display: "flex", color: p.accent, fontSize: 260, fontWeight: 600, lineHeight: 1, height: 150 }}>“</div>
      <div
        style={{
          color: p.text,
          fontSize: titleSize(visual.title, "quote"),
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          paddingLeft: 40,
          borderLeft: `10px solid ${p.accent}`,
        }}
      >
        {visual.title}
      </div>
    </div>
  );
}

function Body({ visual, p }: { visual: PostVisual; p: Paint }): ReactNode {
  switch (visual.kind) {
    case "steps":
      return <Steps visual={visual} p={p} />;
    case "checklist":
      return <Checklist visual={visual} p={p} />;
    case "flow":
      return <Flow visual={visual} p={p} />;
    case "compare":
      return <Compare visual={visual} p={p} />;
    case "stat":
      return <Stat visual={visual} p={p} />;
    case "quote":
      return <Quote visual={visual} p={p} />;
  }
}

export async function drawPostGraphic(input: PostGraphicInput): Promise<ImageResponse> {
  const [regular, semibold] = await Promise.all([
    readFile(join(FONTS, "Geist-Regular.ttf")),
    readFile(join(FONTS, "Geist-SemiBold.ttf")),
  ]);
  const p = paint(input.colors, input.style);
  const { visual } = input;
  const kicker = (input.format && KICKER[input.format]) || null;
  const company = input.company?.trim().slice(0, 48) || null;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: p.ground,
        padding: "88px 88px 72px",
        fontFamily: "Geist",
        gap: 48,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 56, height: 8, borderRadius: 4, background: p.accent }} />
          {kicker ? (
            <div style={{ color: p.accent, fontSize: 30, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {kicker}
            </div>
          ) : null}
        </div>
        {visual.kind === "quote" ? null : (
          <div
            style={{
              color: p.text,
              fontSize: titleSize(visual.title, visual.kind),
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.025em",
            }}
          >
            {visual.title}
          </div>
        )}
      </div>

      <Body visual={visual} p={p} />

      {company ? (
        <div
          style={{
            display: "flex",
            paddingTop: 28,
            borderTop: `2px solid ${p.line}`,
            color: p.muted,
            fontSize: 26,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {company}
        </div>
      ) : null}
    </div>,
    {
      width: GRAPHIC_WIDTH,
      height: GRAPHIC_HEIGHT,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}

/**
 * The company's colours and name, which every picture in a workspace is drawn
 * with. The name is the business profile's own, falling back to the
 * workspace's.
 */
export async function loadGraphicContext(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase-server").createClient>>,
  session: { workspaceId: string },
): Promise<{ colors: BrandColors; company: string | null }> {
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
    company,
  };
}
