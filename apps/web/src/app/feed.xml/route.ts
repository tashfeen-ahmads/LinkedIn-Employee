import { SITE, canonical } from "@/lib/site";
import { CONTENT } from "@/lib/seo-content";

/**
 * /feed.xml: RSS 2.0 for the guides and comparisons.
 *
 * Feeds are still how readers, aggregators and some crawlers learn that a page
 * is new or changed, without waiting for the sitemap to be re-read. Built from
 * the same registry as the sitemap and llms.txt, newest change first.
 */
export const dynamic = "force-static";

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function GET() {
  const items = [...CONTENT]
    .filter((page) => page.kind === "guide" || page.kind === "alternative" || page.kind === "tool")
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.path.localeCompare(b.path));
  const updated = items[0]?.updated ?? "2026-10-12";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(SITE.name)}: LinkedIn outreach guides</title>
    <link>${SITE.url}</link>
    <description>${escape(SITE.description)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(`${updated}T00:00:00Z`).toUTCString()}</lastBuildDate>
    <atom:link href="${canonical("/feed.xml")}" rel="self" type="application/rss+xml" />
${items
  .map(
    (page) => `    <item>
      <title>${escape(page.title)}</title>
      <link>${canonical(page.path)}</link>
      <guid isPermaLink="true">${canonical(page.path)}</guid>
      <description>${escape(page.description)}</description>
      <pubDate>${new Date(`${page.published}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
