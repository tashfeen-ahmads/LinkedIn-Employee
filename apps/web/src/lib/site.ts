import type { Metadata } from "next";
import { TRIAL_DAYS } from "@/lib/plans";
import { BRAND, LINKEDIN_LIMITS, SUSTAINED_INVITES_PER_DAY, WEEKS_TO_SUSTAINED, appOrigin, siteOrigin } from "@le/shared";

/**
 * One description of the site, used by every page's metadata, the sitemap, the
 * robots file and the structured data.
 *
 * Search engines punish disagreement between these more than they punish any
 * single weak page: a canonical that points somewhere the sitemap does not
 * list, an OG title that contradicts the <title>. Keeping them derived from one
 * object is how they stay consistent while pages get added.
 */
export const SITE = {
  name: BRAND.name,
  /** Set NEXT_PUBLIC_SITE_URL on a preview; the fallback is production. */
  url: siteOrigin(process.env.NEXT_PUBLIC_SITE_URL),
  /**
   * The dashboard lives on its own host, so every link from a marketing page
   * into the product has to be absolute. A relative /login on the marketing
   * domain lands on a page that cannot hold a session — and the redirects in
   * netlify.toml would catch it, but only as a hop somebody paid for.
   *
   * Read on the server, where APP_URL exists. Every caller is a server
   * component; in a client one this would silently become production.
   */
  app: appOrigin(process.env.APP_URL),
  tagline: BRAND.tagline,
  description:
    `Nora is an AI SDR for LinkedIn. It finds your buyers, writes each one a personal note, answers their replies and books the meetings. ${TRIAL_DAYS}-day free trial, no card.`,
  locale: "en_US",
} as const;

export function canonical(path: string): string {
  return `${SITE.url}${path === "/" ? "" : path}`;
}

/**
 * Page metadata, with the parts that are easy to forget filled in: a canonical
 * that matches the sitemap, an OG image sized for a link preview, and a title
 * template so no page ships as just the product name.
 */
export function pageMeta(input: {
  title: string;
  description: string;
  path: string;
  /** Set on pages that should stay out of the index (thin, gated or duplicate). */
  noIndex?: boolean;
}): Metadata {
  const url = canonical(input.path);
  const ogImage = `${SITE.url}/og?title=${encodeURIComponent(input.title)}`;

  return {
    // Absolute: every page's title is written to stand alone in 60 characters,
    // and a site suffix would push the keyword-first ones past it.
    title: { absolute: input.title },
    description: input.description,
    alternates: { canonical: url },
    robots: input.noIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "website",
      url,
      siteName: SITE.name,
      title: input.title,
      description: input.description,
      locale: SITE.locale,
      images: [{ url: ogImage, width: 1200, height: 630, alt: input.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [ogImage],
    },
  };
}

/**
 * Every page that should be indexed, in the order a reader would meet them.
 *
 * `updated` is the day the page's content last changed, written by hand when
 * it does. The sitemap used to stamp every page with the build time, so every
 * deploy claimed every page had changed, and a crawler that sees that learns
 * to ignore the field altogether.
 */
export const PAGES = [
  { path: "/", changeFrequency: "weekly", priority: 1.0, updated: "2026-10-12" },
  { path: "/how-it-works", changeFrequency: "monthly", priority: 0.9, updated: "2026-10-12" },
  { path: "/linkedin-automation-limits", changeFrequency: "monthly", priority: 0.9, updated: "2026-10-12" },
  // Kept, and kept indexed: it answers "what does it cost" with "nothing, for now".
  { path: "/pricing", changeFrequency: "monthly", priority: 0.5, updated: "2026-10-12" },
  { path: "/security", changeFrequency: "monthly", priority: 0.6, updated: "2026-10-12" },
  { path: "/about", changeFrequency: "yearly", priority: 0.4, updated: "2026-10-12" },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3, updated: "2026-10-13" },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3, updated: "2026-10-13" },
] as const;

/**
 * The caps, quoted from the constants the worker actually enforces rather than
 * retyped into the copy. A marketing number that drifts from the running code
 * is how a safety claim becomes a lie nobody noticed.
 */
export const PUBLIC_LIMITS = {
  invitesPerDayStart: LINKEDIN_LIMITS.invitesPerDayStart,
  /**
   * What a warmed account actually sends on a working day. The daily cap goes
   * higher, but on a five-day week the weekly cap stops it here, and every page
   * that said "rising to 35" promised a number nobody could reach.
   */
  invitesPerDayMax: SUSTAINED_INVITES_PER_DAY,
  /** The daily cap itself, for the few places that mean the ceiling of a single day. */
  invitesPerDayCeiling: LINKEDIN_LIMITS.invitesPerDayMax,
  invitesPerWeek: LINKEDIN_LIMITS.invitesPerWeek,
  messagesPerDay: LINKEDIN_LIMITS.messagesPerDay,
  /** Weeks until the ramp reaches the working-day pace. */
  warmupWeeks: WEEKS_TO_SUSTAINED,
  /** Weeks until the daily cap reaches its ceiling. */
  ceilingWeeks: Math.round(LINKEDIN_LIMITS.warmupDays / 7),
  healthyAcceptance: Math.round(LINKEDIN_LIMITS.minHealthyAcceptanceRate * 100),
} as const;
