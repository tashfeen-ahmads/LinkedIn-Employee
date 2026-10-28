import { fetchVetted } from "./vetted-fetch.js";

/*
 * This week's news in an audience's industry, for the weekly update post
 * (rule 69).
 *
 * A post that tells an industry what happened in it this week is the most
 * shared kind there is, and the one a model is most likely to invent. So the
 * writer is never asked to know the news: it is handed real headlines from the
 * last seven days, each with its publication, and may say nothing beyond them.
 * No headlines, no update post.
 */

export interface NewsItem {
  title: string;
  source: string;
  /** YYYY-MM-DD. */
  date: string;
  url: string;
}

const WEEK_MS = 7 * 86_400_000;
const MAX_ITEMS = 8;

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .trim();
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return match ? decode(match[1]!) : null;
}

/**
 * A news feed's items from the last week, newest first. Pure, so the reading
 * is tested without the network. A headline carries its publication after a
 * final " - ", which is taken off and used as the source when the feed gives
 * none of its own.
 */
export function parseNewsRss(xml: string, now: Date): NewsItem[] {
  const out: NewsItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1]!;
    let title = tag(item, "title") ?? "";
    let source = tag(item, "source") ?? "";
    const dash = title.lastIndexOf(" - ");
    if (dash > 0) {
      const suffix = title.slice(dash + 3).trim();
      if (!source || suffix === source) source = source || suffix;
      title = title.slice(0, dash).trim();
    }
    const published = Date.parse(tag(item, "pubDate") ?? "");
    if (!title || !source || !Number.isFinite(published)) continue;
    if (now.getTime() - published > WEEK_MS || published - now.getTime() > 86_400_000) continue;
    out.push({ title, source, date: new Date(published).toISOString().slice(0, 10), url: tag(item, "link") ?? "" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Up to eight of this week's headlines across an audience's industries, one
 * feed read per term and at most three terms. A term that fails is skipped;
 * nothing here is ever invented to fill the gap.
 */
export async function industryNews(terms: readonly string[], now = new Date()): Promise<NewsItem[]> {
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const term of [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 3)) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${term} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const fetched = await fetchVetted(url, { timeoutMs: 10_000, headers: { "user-agent": "LinkedInEmployee/1.0 (+news)" } });
      if (!fetched.ok || !fetched.response.ok) continue;
      for (const item of parseNewsRss(await fetched.response.text(), now)) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    } catch {
      continue;
    }
  }
  return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_ITEMS);
}
