#!/usr/bin/env node
/**
 * Site-wide SEO checks for the marketing site, read from the source files.
 *
 *   node scripts/seo-check.mjs
 *
 * No network, no build, no dependencies. Exits 1 when any check fails.
 *
 * What it verifies, and why each one is a check rather than a convention:
 *
 *  1. Every path in CONTENT and HUBS (apps/web/src/lib/seo-content.ts) has a
 *     page file. The sitemap, hubs, footer and "Read next" all read the
 *     registry, so a registered path with no page is a 404 linked from
 *     everywhere at once.
 *  2. Titles are 60 characters or fewer and descriptions 155 or fewer, which
 *     is roughly where search results truncate them.
 *  3. Each registry `query` is unique: two pages built around one query
 *     compete with each other.
 *  4. Every literal internal href ("/...") in the marketing pages and the
 *     components points at a route that exists.
 *  5. Every content page has at least two inbound links written into other
 *     page or component files. The registry's "Read next" cards are counted
 *     separately and reported, but do not satisfy the check: a page only
 *     reachable from a generated card list is a page nobody chose to cite.
 *  6. No page renders more than one <h1> of its own (ArticleLayout and
 *     HubLayout already render one).
 *  7. No em dash or en dash in any (marketing) page file, outside comments,
 *     including the \u2014 / &mdash; spellings.
 *
 * Warnings (reported, never fail): a deep link "/x#anchor" whose target page
 * has no id="anchor", and dashes in string literals of local modules a
 * marketing page imports (they reach the page just the same).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps/web");
const SRC = join(WEB, "src");
const APP = join(SRC, "app");
const MARKETING = join(APP, "(marketing)");
const COMPONENTS = join(SRC, "components");
const REGISTRY = join(SRC, "lib/seo-content.ts");

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 155;
const MIN_INBOUND = 2;

const rel = (file) => relative(ROOT, file);

function walk(dir, filter = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out.sort();
}

/**
 * Removes // and /* *\/ comments while leaving string contents alone, so a URL
 * inside a string is not mistaken for a comment. ' and " strings end at a
 * newline as well, which limits the damage an apostrophe in JSX text can do.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === c) break;
        if (c !== "`" && source[j] === "\n") break;
        j++;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** String literals in already comment-stripped code, with their contents. */
function stringLiterals(code) {
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

// ---------------------------------------------------------------- registry

function readRegistry() {
  const text = readFileSync(REGISTRY, "utf8");
  const str = String.raw`"((?:[^"\\]|\\.)*)"`;
  const field = (block, key) => {
    const m = block.match(new RegExp(String.raw`\b${key}:\s*${str}`));
    return m ? JSON.parse(`"${m[1]}"`) : null;
  };
  const contentStart = text.indexOf("export const CONTENT");
  const contentEnd = text.indexOf("] as const;", contentStart);
  const hubsStart = text.indexOf("export const HUBS");
  const hubsEnd = text.indexOf("] as const", hubsStart);
  if (contentStart < 0 || contentEnd < 0 || hubsStart < 0 || hubsEnd < 0) {
    throw new Error(`could not find CONTENT and HUBS in ${rel(REGISTRY)}`);
  }
  const blocks = (body) =>
    body
      .split(/\n\s*\{\s*(?=\n|\s*path:)/)
      .slice(1)
      .map((block) => block.trim());
  const content = blocks(text.slice(contentStart, contentEnd)).map((block) => ({
    path: field(block, "path"),
    kind: field(block, "kind"),
    title: field(block, "title"),
    description: field(block, "description"),
    query: field(block, "query"),
    related: [...(block.match(/related:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  }));
  const hubs = [...text.slice(hubsStart, hubsEnd).matchAll(/\{\s*path:[^\n]*\}/g)].map((m) => ({
    path: field(m[0], "path"),
    kind: field(m[0], "kind"),
    title: field(m[0], "title"),
    description: field(m[0], "description"),
    query: null,
    related: [],
  }));
  return { content, hubs };
}

// ------------------------------------------------------------------ routes

function routeOf(file) {
  const parts = relative(APP, dirname(file))
    .split("/")
    .filter((p) => p && !/^\(.*\)$/.test(p) && !p.startsWith("@"));
  return "/" + parts.join("/");
}

function buildRoutes() {
  const files = walk(APP, (f) => /\/(page\.tsx?|route\.tsx?)$/.test(f));
  const patterns = files.map((file) => {
    const route = routeOf(file);
    const re = route
      .split("/")
      .map((seg) => {
        if (/^\[\[?\.\.\./.test(seg)) return ".*";
        if (/^\[.*\]$/.test(seg)) return "[^/]+";
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { route, file, re: new RegExp(`^${re === "" ? "/" : re}/?$`) };
  });
  // Metadata routes Next generates from special files.
  const extra = [];
  if (existsSync(join(APP, "robots.ts"))) extra.push("/robots.txt");
  if (existsSync(join(APP, "sitemap.ts"))) extra.push("/sitemap.xml");
  if (existsSync(join(APP, "icon.tsx"))) extra.push("/icon");
  for (const f of walk(join(WEB, "public"))) extra.push("/" + relative(join(WEB, "public"), f));
  for (const route of extra) patterns.push({ route, file: null, re: new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  return patterns;
}

function routeExists(routes, path) {
  return routes.find((r) => r.re.test(path)) ?? null;
}

// ------------------------------------------------------------------- hrefs

/**
 * Literal internal hrefs in a file: href="/x", href={"/x"}, href={`/x`},
 * href={`${SITE.app}/x`} and object keys href: "/x". Expressions such as
 * href={card.path} are not literal and are skipped.
 */
function hrefsIn(code) {
  const out = [];
  const re = /\bhref(?:=\{?|:\s*)(["'`])((?:\$\{SITE\.(?:app|url)\})?\/[^"'`\s]*)\1?/g;
  let m;
  while ((m = re.exec(code))) {
    let raw = m[2].replace(/^\$\{SITE\.(?:app|url)\}/, "");
    if (raw.startsWith("//")) continue; // protocol-relative: external
    // A template placeholder stands for one dynamic segment.
    raw = raw.replace(/\$\{[^}]*\}/g, "x");
    const [pathAndQuery, hash = null] = raw.split("#");
    const path = pathAndQuery.split("?")[0] || "/";
    out.push({ raw: m[2], path: path.length > 1 ? path.replace(/\/$/, "") : path, hash });
  }
  return out;
}

// -------------------------------------------------------------------- main

const failures = [];
const warnings = [];
const passed = [];
function check(name, problems) {
  if (problems.length) failures.push({ name, problems });
  else passed.push(name);
}

const { content, hubs } = readRegistry();
const registered = [...content, ...hubs];
const pageFile = (path) => join(MARKETING, path === "/" ? "" : path, "page.tsx");
const routes = buildRoutes();

const marketingFiles = walk(MARKETING, (f) => /\.(tsx?|mdx?)$/.test(f));
const componentFiles = walk(COMPONENTS, (f) => /\.tsx?$/.test(f));
const scanned = [...marketingFiles, ...componentFiles];
const code = new Map(scanned.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));

// 1. Every registered path has a page file.
check(
  "every CONTENT and HUBS path has a page file",
  registered.filter((p) => !existsSync(pageFile(p.path))).map((p) => `${p.path}: no ${rel(pageFile(p.path))}`),
);

// 2. Title and description lengths.
check(
  `titles <= ${TITLE_MAX} characters`,
  registered.filter((p) => !p.title || p.title.length > TITLE_MAX).map((p) => `${p.path}: ${p.title?.length ?? "missing"} chars "${p.title}"`),
);
check(
  `descriptions <= ${DESCRIPTION_MAX} characters`,
  registered
    .filter((p) => !p.description || p.description.length > DESCRIPTION_MAX)
    .map((p) => `${p.path}: ${p.description?.length ?? "missing"} chars`),
);

// 3. Unique queries.
{
  const seen = new Map();
  const problems = [];
  for (const p of content) {
    if (!p.query) {
      problems.push(`${p.path}: no query`);
      continue;
    }
    const key = p.query.trim().toLowerCase();
    if (seen.has(key)) problems.push(`"${p.query}" is the query of both ${seen.get(key)} and ${p.path}`);
    else seen.set(key, p.path);
  }
  check("each registry query is unique", problems);
}

// 4. Internal hrefs resolve to routes.
{
  const problems = [];
  for (const [file, src] of code) {
    for (const href of hrefsIn(src)) {
      const target = routeExists(routes, href.path);
      if (!target) {
        problems.push(`${rel(file)}: ${href.raw} -> no such route`);
        continue;
      }
      if (href.hash && target.file && /\/page\.tsx?$/.test(target.file) && !target.route.includes("[")) {
        // The id may be written in the page or in a component it renders.
        const idRe = new RegExp(String.raw`\bid=\{?["'\`]${href.hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
        const anchored = idRe.test(readFileSync(target.file, "utf8")) || componentFiles.some((f) => idRe.test(code.get(f)));
        if (!anchored) warnings.push(`${rel(file)}: ${href.raw} -> ${rel(target.file)} has no id="${href.hash}"`);
      }
    }
  }
  check("every internal href points at an existing route", problems);
}

// 5. Inbound links.
{
  const inbound = new Map(content.map((p) => [p.path, new Set()]));
  const relatedIn = new Map(content.map((p) => [p.path, 0]));
  for (const [file, src] of code) {
    for (const href of hrefsIn(src)) {
      const set = inbound.get(href.path);
      if (set && pageFile(href.path) !== file) set.add(rel(file));
    }
  }
  for (const p of registered) for (const r of p.related) if (relatedIn.has(r) && r !== p.path) relatedIn.set(r, relatedIn.get(r) + 1);
  const problems = [];
  for (const p of content) {
    const n = inbound.get(p.path).size;
    if (n < MIN_INBOUND) problems.push(`${p.path}: ${n} linking file(s) [${[...inbound.get(p.path)].join(", ")}] (+${relatedIn.get(p.path)} "Read next" cards)`);
  }
  check(`every content page has >= ${MIN_INBOUND} inbound links from other files`, problems);
  globalThis.__inbound = { inbound, relatedIn };
}

// 6. One <h1> per page.
{
  const problems = [];
  for (const file of marketingFiles.filter((f) => /\/page\.tsx$/.test(f))) {
    const src = code.get(file);
    const own = (src.match(/<h1[\s>]/g) ?? []).length;
    const fromLayout = /<(ArticleLayout|HubLayout)\b/.test(src) ? 1 : 0;
    if (own + fromLayout > 1) problems.push(`${rel(file)}: ${own} own <h1> + ${fromLayout} from the layout`);
  }
  check("no page has more than one <h1>", problems);
}

// 7. Dashes.
const DASH = /[\u2013\u2014]|\\u201[34]|&[mn]dash;|&#821[12];|&#x201[34];/i;
{
  const problems = [];
  for (const file of marketingFiles) {
    // The characters themselves anywhere outside a comment; the escaped
    // spellings only inside a string literal, since a regex that strips
    // dashes from imported text (/[\u2013\u2014]/) is code, not content.
    const src = code.get(file);
    for (const line of src.split("\n")) {
      if (/[\u2013\u2014]/.test(line)) problems.push(`${rel(file)}: ${line.trim().slice(0, 100)}`);
    }
    for (const s of stringLiterals(src)) {
      if (!/[\u2013\u2014]/.test(s) && DASH.test(s)) problems.push(`${rel(file)}: "${s.slice(0, 100)}"`);
    }
  }
  check("no em or en dash in any (marketing) page file", problems);

  // Warning: local modules a marketing page imports, string literals only.
  const imported = new Set();
  for (const file of marketingFiles) {
    for (const m of code.get(file).matchAll(/from\s+["']@\/((?:lib|components)\/[^"']+)["']/g)) imported.add(m[1]);
  }
  for (const mod of [...imported].sort()) {
    const base = join(SRC, mod);
    const file = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext).find(existsSync);
    if (!file) continue;
    const hits = stringLiterals(stripComments(readFileSync(file, "utf8"))).filter((s) => DASH.test(s));
    for (const hit of hits) warnings.push(`${rel(file)} (imported by a marketing page; reaches it only if that export is rendered): "${hit.slice(0, 80)}"`);
  }
}

// ------------------------------------------------------------------ report

const words = (() => {
  // From the build output when there is one: the article body as rendered.
  const out = [];
  for (const p of content) {
    const html = join(WEB, ".next/server/app", `${p.path}.html`);
    if (!existsSync(html)) return null;
    const doc = readFileSync(html, "utf8");
    const article = doc.match(/<article[\s\S]*?<\/article>/)?.[0] ?? doc;
    const text = article
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ");
    out.push({ path: p.path, words: (text.match(/[A-Za-z0-9][A-Za-z0-9'’.,%$/-]*/g) ?? []).length });
  }
  return out;
})();

console.log(`SEO check: ${content.length} content pages + ${hubs.length} hubs registered, ${scanned.length} files scanned`);
for (const name of passed) console.log(`  PASS  ${name}`);
for (const { name, problems } of failures) {
  console.log(`  FAIL  ${name} (${problems.length})`);
  for (const p of problems) console.log(`          ${p}`);
}
if (warnings.length) {
  console.log(`  WARN  ${warnings.length} warning(s)`);
  for (const w of warnings) console.log(`          ${w}`);
}
if (words) {
  const total = words.reduce((s, w) => s + w.words, 0);
  console.log(`  INFO  ${total} words across ${words.length} content pages (rendered <article>, from .next)`);
  if (process.argv.includes("--words")) for (const w of words) console.log(`          ${String(w.words).padStart(5)}  ${w.path}`);
} else {
  console.log("  INFO  word counts need a build (.next/server/app/*.html)");
}
if (process.argv.includes("--inbound")) {
  const { inbound, relatedIn } = globalThis.__inbound;
  for (const p of content) console.log(`          ${String(inbound.get(p.path).size).padStart(3)} files, ${relatedIn.get(p.path)} cards  ${p.path}`);
}
console.log(`${passed.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
