#!/usr/bin/env node
/**
 * Tell Bing (and every other IndexNow engine) which pages changed.
 *
 *   node scripts/indexnow.mjs                 # every URL in the live sitemap
 *   node scripts/indexnow.mjs /guides/a /b    # just these paths
 *
 * Run after a deploy has finished, never before: IndexNow asks the engine to
 * crawl now, and a crawl of the old build is wasted. The key is public by
 * design; the engine proves ownership by fetching it from the site root, which
 * is the file in apps/web/public/<key>.txt. Google does not use IndexNow; its
 * equivalent is the sitemap, which is already submitted in robots.txt.
 */
import { readdirSync, readFileSync } from "node:fs";

const SITE = (process.env.SITE_URL ?? "https://norasdr.com").replace(/\/$/, "");
const keyFile = readdirSync(new URL("../apps/web/public/", import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("no IndexNow key file in apps/web/public");
const key = readFileSync(new URL(`../apps/web/public/${keyFile}`, import.meta.url), "utf8").trim();

let urls = process.argv.slice(2).map((p) => `${SITE}${p.startsWith("/") ? p : `/${p}`}`);
if (!urls.length) {
  const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList: urls }),
});
console.log(`IndexNow: ${res.status} for ${urls.length} URLs`);
if (res.status >= 400) process.exit(1);
