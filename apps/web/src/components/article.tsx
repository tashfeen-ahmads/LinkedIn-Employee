import Link from "next/link";
import type { Metadata } from "next";
import {
  ArticleSchema,
  BreadcrumbSchema,
  FaqSchema,
  Json,
} from "@/components/schema";
import { SITE, canonical, pageMeta } from "@/lib/site";
import { TEAM_MEMBER } from "@/lib/team";
import {
  GUIDE_GROUPS,
  HUBS,
  contentAt,
  contentOfKind,
  linkCard,
  type ContentKind,
} from "@/lib/seo-content";
import { formatDate } from "@/lib/format";
import { TRIAL_DAYS } from "@/lib/plans";
import { BRAND, INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS, WEEKS_TO_CEILING } from "@le/shared";
import { RampChart } from "./diagrams";

/**
 * The frame every search-facing page wears: guides, alternatives, tools and
 * audience pages alike.
 *
 * One frame so the things search engines and readers both rely on are never
 * forgotten on the fortieth page: a breadcrumb that matches the structured
 * data, a visible "updated" date that matches `dateModified`, the questions
 * marked up as an FAQ, sources listed where a claim came from somewhere else,
 * and somewhere to go next. The title, dates and related pages come from
 * `lib/seo-content.ts`, never from the page, so the sitemap and the page can
 * not disagree.
 */

export interface Faq {
  q: string;
  a: string;
}

export interface Source {
  label: string;
  url: string;
}

/** Breadcrumb names: short, because a crumb is a place, not a headline. */
const HUB_OF: Partial<Record<ContentKind, { name: string; path: string }>> = {
  guide: { name: "Guides", path: "/guides" },
  alternative: { name: "Compare tools", path: "/alternatives" },
  tool: { name: "Free tools", path: "/tools" },
  audience: { name: "Who it's for", path: "/for" },
};

/** Kinds where the reader came to choose a tool, so the offer belongs above the fold. */
const COMMERCIAL: ReadonlySet<ContentKind> = new Set([
  "alternative",
  "audience",
  "landing",
  "tool",
]);

/** The article's own drawn feature image (app/og/article). */
export function featureImage(path: string): string {
  return `${SITE.url}/og/article${path}`;
}

/** Metadata for a registered page, so the page file cannot drift from the registry. */
export function articleMeta(path: string): Metadata {
  const page = contentAt(path);
  const meta = pageMeta({
    title: page.title,
    description: page.description,
    path,
  });
  const image = {
    url: featureImage(path),
    width: 1200,
    height: 630,
    alt: page.title,
  };
  return {
    ...meta,
    // Written to fit 60 characters on its own; the site suffix would push it past.
    title: { absolute: page.title },
    openGraph: {
      ...meta.openGraph,
      type: "article",
      publishedTime: page.published,
      modifiedTime: page.updated,
      images: [image],
    },
    twitter: { card: "summary_large_image", images: [image.url] },
  };
}

export function ArticleLayout({
  path,
  lede,
  faq,
  sources,
  aside,
  h1,
  children,
}: {
  path: string;
  /** The on-page heading, when it should read longer than the <title> (from the brief). */
  h1?: string;
  /** One or two sentences under the title that answer the query outright. */
  lede: string;
  faq?: readonly Faq[];
  sources?: readonly Source[];
  /** Something interactive or visual beside the opening, e.g. a tool. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const page = contentAt(path);
  const hub = HUB_OF[page.kind];
  const trail = [
    { name: "Home", path: "/" },
    ...(hub ? [hub] : []),
    { name: page.title, path },
  ];
  const next = page.related
    .map(linkCard)
    .filter((card): card is NonNullable<typeof card> => card !== null);

  return (
    <article className="article">
      <ArticleSchema
        headline={page.title}
        description={page.description}
        path={path}
        published={page.published}
        modified={page.updated}
        image={featureImage(path)}
      />
      <BreadcrumbSchema trail={trail} />
      {faq?.length ? <FaqSchema items={faq} /> : null}
      {page.kind === "tool" ? (
        <Json
          data={{
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: page.title,
            url: canonical(path),
            description: page.description,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          }}
        />
      ) : null}

      <header className="article-head">
        {trail.length > 2 ? (
          <nav aria-label="Breadcrumb" className="article-crumbs">
            <ol>
              {trail.slice(0, -1).map((crumb) => (
                <li key={crumb.path}>
                  <Link href={crumb.path}>{crumb.name}</Link>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1>{h1 ?? page.title}</h1>
        <p className="article-lede">{lede}</p>
        {/* A use-case page is a landing page, not an essay: a byline there reads as a blog post. */}
        {page.kind === "audience" || page.kind === "landing" ? null : (
          <p className="article-meta">
            <span
              className={`article-owner is-${page.owner}`}
              aria-hidden="true"
            >
              {TEAM_MEMBER[page.owner].name[0]}
            </span>
            <span>
              From{" "}
              <Link href="/how-it-works">{TEAM_MEMBER[page.owner].name}</Link>,{" "}
              {TEAM_MEMBER[page.owner].role.toLowerCase()} on Nora&apos;s team.
              Updated{" "}
              <time dateTime={page.updated}>{formatDate(page.updated)}</time>
            </span>
          </p>
        )}
      </header>

      {/*
        The drawn feature image is the article's social card, structured-data
        image and sitemap image, and is not repeated on the page: under the H1
        it restated the headline in other words and pushed the answer below
        the fold.
      */}
      {COMMERCIAL.has(page.kind) ? <ArticleCta compact /> : null}

      {aside ? <div className="article-aside">{aside}</div> : null}

      <div className="article-body">{children}</div>

      {COMMERCIAL.has(page.kind) ? null : <ArticleCta />}

      {faq?.length ? (
        <section className="article-faq" aria-labelledby="article-faq-heading">
          <h2 id="article-faq-heading">Questions</h2>
          {faq.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </section>
      ) : null}

      {sources?.length ? (
        <section
          className="article-sources"
          aria-labelledby="article-sources-heading"
        >
          <h2 id="article-sources-heading">Sources</h2>
          <ol>
            {sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} rel="noopener nofollow" target="_blank">
                  {source.label}
                </a>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {next.length ? (
        <nav className="article-next" aria-labelledby="article-next-heading">
          <h2 id="article-next-heading">Read next</h2>
          <ul>
            {next.map((card) => (
              <li key={card.path}>
                <Link href={card.path}>
                  <strong>{card.title}</strong>
                  <span>{card.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </article>
  );
}

/**
 * The offer, as a button rather than a capitalised link mid-sentence. Above the
 * fold on pages where the reader came to choose a tool; after the body on
 * guides, where they came to learn something first.
 */
function ArticleCta({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`article-cta${compact ? " is-compact" : ""}`}>
      <div>
        <p className="article-cta-title">
          {compact ? `Try Nora free for ${TRIAL_DAYS} days` : "Let Nora run this for you"}
        </p>
        <p className="article-cta-text">
          {compact
            ? "No card. You approve who it reaches, what they read and the launch."
            : `It finds the people, writes one note per person and paces the sending inside these limits. ${TRIAL_DAYS}-day free trial, no card.`}
        </p>
      </div>
      <div className="article-cta-actions">
        <a className="btn" href={`${SITE.app}/signup`}>
          Start a {TRIAL_DAYS}-day free trial
        </a>
        <Link className="btn secondary" href="/how-it-works">
          How it works
        </Link>
      </div>
    </div>
  );
}

/** A plain comparison table: rows of facts, columns of products. */
export function CompareTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly string[];
  rows: ReadonlyArray<{ label: string; values: readonly React.ReactNode[] }>;
}) {
  // Focusable, because a table that scrolls sideways must be scrollable from the keyboard too.
  return (
    // prettier-ignore
    <div className="article-table table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Compared</span>
            </th>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((v, i) => (
                // The column name rides on the cell so a phone can show each
                // row as a labelled card instead of hiding half the columns.
                <td key={i} data-label={columns[i]}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A short highlighted note inside an article: a rule, a warning, a number. */
export function Callout({
  tone = "info",
  children,
}: {
  tone?: "info" | "safety" | "warning";
  children: React.ReactNode;
}) {
  // A note inside the article, not a page-level side region: <aside> here was a
  // landmark nested in the article, which screen readers list as page furniture.
  return (
    <div className={`article-callout is-${tone}`} role="note">
      {children}
    </div>
  );
}

/** The on-page heading per hub, written to carry the hub's keyword (docs/seo/seo-plan.json). */
const HUB_H1: Partial<Record<ContentKind, string>> = {
  alternative:
    "LinkedIn automation tools, compared on what keeps an account safe",
};

/** The crumb's own word for each hub: a place, not its headline. */
const HUB_CRUMB: Record<ContentKind, string> = {
  guide: "Guides",
  alternative: "Compare tools",
  tool: "Free tools",
  audience: "Who it's for",
  landing: "",
};

/**
 * The sentence under each hub's heading. The registry's description is
 * written for a search result and restated the heading in other words; on
 * the page the reader already has the heading, so this says what is below it.
 */
function hubLede(kind: ContentKind, count: number): string {
  switch (kind) {
    case "guide":
      return `All ${count} guides are written from the rules ${BRAND.name} runs on, grouped by the question you came with: how much is safe to send, what to write, how to follow up and how to choose a tool.`;
    case "alternative":
      return `The ${count} tools below, compared on what each one publishes about daily caps, warm-up, pacing and contacting somebody twice, with every price dated and sourced.`;
    case "audience":
      return `How ${BRAND.name} works for ${count} kinds of business that sell through LinkedIn: finding their buyers, writing to each one and booking the call without putting the sending account at risk.`;
    case "tool":
      return `Free tools built on the same rules ${BRAND.name} runs on. Nothing you type is stored.`;
    default:
      return "";
  }
}

/** Straight quotes in registry copy, set as typographic ones on the page. */
function curly(text: string): string {
  return text
    .replace(/(\w)'(\w)/g, "$1\u2019$2")
    .replace(/(^|[\s(])'([^']+)'(?=[\s,.;:!?)]|$)/g, "$1\u2018$2\u2019")
    .replace(/(^|[\s(])"([^"]+)"(?=[\s,.;:!?)]|$)/g, "$1\u201c$2\u201d");
}

/**
 * A small drawing of each free tool on its card, built from the same limits
 * the tool itself reads, so the card shows what opening it gets you.
 */
function ToolPreview({ path }: { path: string }) {
  if (path.includes("note-checker")) {
    const note =
      "Hi Maya, saw you took over growth at Calder & Finch this spring. Curious how you are splitting outbound between the two new hires.";
    return (
      <div className="hub-preview" aria-hidden="true">
        <p className="hub-preview-note">{note}</p>
        <div className="hub-preview-row">
          <span className="hub-preview-meter">
            <span style={{ width: `${Math.round((note.length / INVITE_NOTE_MAX_CHARS) * 100)}%` }} />
          </span>
          <span className="mk-num">
            {note.length} / {INVITE_NOTE_MAX_CHARS}
          </span>
        </div>
        <ul className="hub-preview-checks">
          <li>Fits the limit</li>
          <li>No link</li>
          <li>No pitch</li>
        </ul>
      </div>
    );
  }
  return (
    <div className="hub-preview" aria-hidden="true">
      <p className="hub-preview-row">
        <span>Daily cap</span>
        <span className="mk-num">
          {LINKEDIN_LIMITS.invitesPerDayStart} rising to {LINKEDIN_LIMITS.invitesPerDayMax} over{" "}
          {WEEKS_TO_CEILING} weeks
        </span>
      </p>
      <RampChart />
    </div>
  );
}

export function HubLayout({
  kind,
  children,
}: {
  kind: ContentKind;
  children?: React.ReactNode;
}) {
  const hub = HUBS.find((h) => h.kind === kind);
  if (!hub) throw new Error(`no hub for ${kind}`);
  const pages = contentOfKind(kind);
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const groups =
    kind === "guide"
      ? GUIDE_GROUPS.map((group) => ({
          name: group.name,
          pages: group.paths.flatMap((p) => byPath.get(p) ?? []),
        }))
      : [{ name: null as string | null, pages }];
  const grouped = new Set(groups.flatMap((g) => g.pages.map((p) => p.path)));
  const loose = pages.filter((p) => !grouped.has(p.path));
  if (loose.length)
    groups.push({ name: groups[0]?.name ? "More guides" : null, pages: loose });

  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: hub.title, path: hub.path },
        ]}
      />
      <Json
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: hub.title,
          description: hub.description,
          url: canonical(hub.path),
          mainEntity: {
            "@type": "ItemList",
            itemListElement: pages.map((page, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: canonical(page.path),
              name: page.title,
            })),
          },
        }}
      />
      {/* The same opening every inner page wears, so a hub is not the one
          page in the site whose title sits higher and on a flat ground. */}
      <section className="mk-page-hero hero-wash">
        <div className="container mk-page-hero-inner">
          <nav className="mk-crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{HUB_CRUMB[kind]}</span>
          </nav>
          <h1>{HUB_H1[kind] ?? hub.title}</h1>
          <div className="mk-page-lede">
            <p>{hubLede(kind, pages.length)}</p>
          </div>
        </div>
      </section>

      <section className={`hub container is-${kind}`}>
        {groups.map((group) => (
          <div key={group.name ?? "all"} className="hub-group">
            {group.name ? (
              <h2 className="hub-group-title">
                {group.name}
                <span className="hub-group-count mk-num">{group.pages.length}</span>
              </h2>
            ) : null}
            {kind === "tool" ? (
              <ul className="hub-tools">
                {group.pages.map((page) => (
                  <li key={page.path}>
                    <Link href={page.path}>
                      <ToolPreview path={page.path} />
                      <strong>{page.title}</strong>
                      <span>{curly(page.description)}</span>
                      <em className="hub-open" aria-hidden="true">
                        Open the tool &rarr;
                      </em>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="hub-index">
                {group.pages.map((page) => (
                  <li key={page.path}>
                    <Link href={page.path}>
                      <strong>{curly(page.title)}</strong>
                      <span>{curly(page.description)}</span>
                      <span className="hub-index-arrow" aria-hidden="true">
                        &rarr;
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {children}
      </section>
    </>
  );
}

export function hubMeta(kind: ContentKind): Metadata {
  const hub = HUBS.find((h) => h.kind === kind);
  if (!hub) throw new Error(`no hub for ${kind}`);
  return {
    ...pageMeta({
      title: hub.title,
      description: hub.description,
      path: hub.path,
    }),
    title: { absolute: hub.title },
  };
}
