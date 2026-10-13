import type { MetadataRoute } from "next";
import { PAGES, SITE, canonical } from "@/lib/site";
import { CONTENT, HUBS } from "@/lib/seo-content";

/**
 * Every indexable page: the core six, the three hubs and the content they
 * list. A hub has no date of its own; it changes when anything in it does.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const at = (day: string) => new Date(`${day}T00:00:00Z`);
  const latest = (kind: string) =>
    CONTENT.filter((page) => page.kind === kind)
      .map((page) => page.updated)
      .sort()
      .at(-1) ?? PAGES[0].updated;

  return [
    ...PAGES.map((page) => ({
      url: canonical(page.path),
      lastModified: at(page.updated),
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...HUBS.map((hub) => ({
      url: canonical(hub.path),
      lastModified: at(latest(hub.kind)),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...CONTENT.map((page) => ({
      url: canonical(page.path),
      lastModified: at(page.updated),
      // The article's drawn feature image, so image search can find it.
      images: [`${SITE.url}/og/article${page.path}`],
      changeFrequency: "monthly" as const,
      priority: page.kind === "tool" || page.kind === "landing" ? 0.8 : 0.6,
    })),
  ];
}
