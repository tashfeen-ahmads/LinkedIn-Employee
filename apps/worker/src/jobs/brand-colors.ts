import { brandColorsFromHtml, type BrandColors } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { fetchVetted } from "../vetted-fetch.js";
import { pagesToRead } from "./strategy.js";

/**
 * The company's own colours, read from its website, for the graphic published
 * with each post (migration 0060).
 *
 * Run after Sage reads the site, which only fills colours nobody has set, and
 * from the Company page's button, which replaces them because a person asked.
 * Every page goes through `fetchVetted` (rule 19): the address was typed by
 * whoever signed up. Two stylesheets at most, because a brand's colours are
 * usually in its first one and every fetch is a wait somebody sits through.
 */
const MAX_STYLESHEETS = 2;
const MAX_BYTES = 400_000;

export async function readSiteColors(websiteUrl: string): Promise<BrandColors | null> {
  const page = pagesToRead(websiteUrl)[0];
  if (!page) return null;
  const html = await getText(page);
  if (!html) return null;

  const sheets: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (sheets.length >= MAX_STYLESHEETS) break;
    const tag = match[0];
    if (!/rel=["']?stylesheet/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    let url: string;
    try {
      url = new URL(href, page).toString();
    } catch {
      continue;
    }
    const css = await getText(url);
    if (css) sheets.push(css);
  }
  return brandColorsFromHtml(html, sheets);
}

async function getText(url: string): Promise<string | null> {
  try {
    const fetched = await fetchVetted(url, {
      timeoutMs: 10_000,
      headers: { "user-agent": "LinkedInEmployee/1.0 (+brand-colors)" },
    });
    if (!fetched.ok || !fetched.response.ok) return null;
    const text = await fetched.response.text();
    return text.slice(0, MAX_BYTES);
  } catch {
    return null;
  }
}

/**
 * Read the site and store what it says. `replace` overwrites colours already
 * set; without it a workspace that has colours keeps them, so a person's own
 * choice is never undone by a background run.
 */
export async function detectBrandColors(
  ctx: WorkerContext,
  input: { workspaceId: string; websiteUrl: string; replace: boolean },
  read: (websiteUrl: string) => Promise<BrandColors | null> = readSiteColors,
): Promise<{ colors: BrandColors | null; saved: boolean }> {
  const colors = await read(input.websiteUrl);
  if (!colors?.primary) return { colors: null, saved: false };
  let update = ctx.db
    .from("workspaces")
    .update({ brand_primary: colors.primary, brand_accent: colors.accent })
    .eq("id", input.workspaceId);
  if (!input.replace) update = update.is("brand_primary", null);
  const { data } = await update.select("id");
  return { colors, saved: Boolean(data?.length) };
}

/** The website a workspace gave, newest business profile first, then setup's answer. */
export async function workspaceWebsite(ctx: WorkerContext, workspaceId: string): Promise<string | null> {
  const { data: profiles } = await ctx.db
    .from("business_profiles")
    .select("website_url, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1);
  const fromProfile = profiles?.[0]?.website_url?.trim();
  if (fromProfile) return fromProfile;
  const { data: ws } = await ctx.db.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle();
  const source = (ws?.onboarding as { source?: { websiteUrl?: unknown } } | null)?.source;
  return typeof source?.websiteUrl === "string" && source.websiteUrl.trim() ? source.websiteUrl.trim() : null;
}
