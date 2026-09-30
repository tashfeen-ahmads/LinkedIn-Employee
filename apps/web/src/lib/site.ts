import type { Metadata } from "next";
import { BRAND, LINKEDIN_LIMITS, appOrigin, siteOrigin } from "@le/shared";

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
    "An AI SDR that finds your buyers on LinkedIn, writes the outreach, answers the replies and books the meeting — inside daily limits that keep your account safe.",
  locale: "en_GB",
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
    title: input.title,
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

/** Every page that should be indexed, in the order a reader would meet them. */
export const PAGES = [
  { path: "/", changeFrequency: "weekly", priority: 1.0 },
  { path: "/how-it-works", changeFrequency: "monthly", priority: 0.9 },
  { path: "/linkedin-automation-limits", changeFrequency: "monthly", priority: 0.9 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/security", changeFrequency: "monthly", priority: 0.6 },
  { path: "/about", changeFrequency: "yearly", priority: 0.4 },
] as const;

/**
 * The caps, quoted from the constants the worker actually enforces rather than
 * retyped into the copy. A marketing number that drifts from the running code
 * is how a safety claim becomes a lie nobody noticed.
 */
export const PUBLIC_LIMITS = {
  invitesPerDayStart: LINKEDIN_LIMITS.invitesPerDayStart,
  invitesPerDayMax: LINKEDIN_LIMITS.invitesPerDayMax,
  invitesPerWeek: LINKEDIN_LIMITS.invitesPerWeek,
  messagesPerDay: LINKEDIN_LIMITS.messagesPerDay,
  warmupWeeks: Math.round(LINKEDIN_LIMITS.warmupDays / 7),
  healthyAcceptance: Math.round(LINKEDIN_LIMITS.minHealthyAcceptanceRate * 100),
} as const;
