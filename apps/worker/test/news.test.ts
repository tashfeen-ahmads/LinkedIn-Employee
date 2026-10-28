import { describe, expect, it } from "vitest";
import { parseNewsRss } from "../src/news.js";

/*
 * The weekly industry update is written only from real headlines (rule 69).
 * The feed is read here without the network: what is older than a week is
 * dropped, the publication is kept beside each headline, and nothing in the
 * feed's markup reaches the writer as text.
 */

const NOW = new Date("2026-10-28T12:00:00Z");

const item = (title: string, pubDate: string, source = "") => `
  <item>
    <title><![CDATA[${title}]]></title>
    <link>https://news.example.com/${encodeURIComponent(title)}</link>
    <pubDate>${pubDate}</pubDate>
    ${source ? `<source url="https://example.com">${source}</source>` : ""}
  </item>`;

describe("parseNewsRss", () => {
  it("keeps the last seven days, newest first, with each publication", () => {
    const xml = `<rss><channel>
      ${item("Plumbers face new licence rules - Trade Weekly", "Mon, 27 Oct 2026 09:00:00 GMT")}
      ${item("Water heater prices rise &amp; supply tightens", "Thu, 23 Oct 2026 09:00:00 GMT", "Builder News")}
      ${item("An old story from last month - Old Times", "Tue, 14 Oct 2026 09:00:00 GMT")}
    </channel></rss>`;
    expect(parseNewsRss(xml, NOW)).toEqual([
      { title: "Plumbers face new licence rules", source: "Trade Weekly", date: "2026-10-27", url: expect.any(String) },
      { title: "Water heater prices rise & supply tightens", source: "Builder News", date: "2026-10-23", url: expect.any(String) },
    ]);
  });

  it("drops an item with no date or no publication rather than guessing", () => {
    const xml = `<rss><channel>
      ${item("No date at all - Trade Weekly", "")}
      ${item("Nobody published this", "Mon, 27 Oct 2026 09:00:00 GMT")}
    </channel></rss>`;
    expect(parseNewsRss(xml, NOW)).toEqual([]);
  });
});
