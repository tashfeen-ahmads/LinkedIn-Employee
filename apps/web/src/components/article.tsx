import Link from "next/link";
import type { Metadata } from "next";
import { ArticleSchema, BreadcrumbSchema, FaqSchema, Json } from "@/components/schema";
import { SITE, canonical, pageMeta } from "@/lib/site";
import { TEAM_MEMBER } from "@/lib/team";
import { HUBS, contentAt, contentOfKind, linkCard, type ContentKind } from "@/lib/seo-content";
import { formatDate } from "@/lib/format";

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
};

/** The article's own drawn feature image (app/og/article). */
export function featureImage(path: string): string {
  return `${SITE.url}/og/article?path=${encodeURIComponent(path)}`;
}

/** Metadata for a registered page, so the page file cannot drift from the registry. */
export function articleMeta(path: string): Metadata {
  const page = contentAt(path);
  const meta = pageMeta({ title: page.title, description: page.description, path });
  const image = { url: featureImage(path), width: 1200, height: 630, alt: page.title };
  return {
    ...meta,
    // Written to fit 60 characters on its own; the site suffix would push it past.
    title: { absolute: page.title },
    openGraph: { ...meta.openGraph, type: "article", publishedTime: page.published, modifiedTime: page.updated, images: [image] },
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
  const trail = [{ name: "Home", path: "/" }, ...(hub ? [hub] : []), { name: page.title, path }];
  const next = page.related.map(linkCard).filter((card): card is NonNullable<typeof card> => card !== null);

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
        <nav aria-label="Breadcrumb" className="article-crumbs">
          <ol>
            {trail.slice(0, -1).map((crumb) => (
              <li key={crumb.path}>
                <Link href={crumb.path}>{crumb.name}</Link>
              </li>
            ))}
          </ol>
        </nav>
        <h1>{h1 ?? page.title}</h1>
        <p className="article-lede">{lede}</p>
        <p className="article-meta">
          <span className={`article-owner is-${page.owner}`} aria-hidden="true">
            {TEAM_MEMBER[page.owner].name[0]}
          </span>
          <span>
            From <Link href="/how-it-works">{TEAM_MEMBER[page.owner].name}</Link>, {TEAM_MEMBER[page.owner].role.toLowerCase()} on
            Nora&apos;s team. Updated <time dateTime={page.updated}>{formatDate(page.updated)}</time>
          </span>
        </p>
      </header>

      {/* The drawn feature image: priority, because it is the first thing on the page. */}
      <img
        className="article-feature"
        src={`/og/article?path=${encodeURIComponent(path)}`}
        alt=""
        width={1200}
        height={630}
        fetchPriority="high"
        decoding="async"
      />

      {aside ? <div className="article-aside">{aside}</div> : null}

      <div className="article-body">{children}</div>

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
        <section className="article-sources" aria-labelledby="article-sources-heading">
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
  return (
    <div className="article-table table-scroll">
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
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A short highlighted note inside an article: a rule, a warning, a number. */
export function Callout({ tone = "info", children }: { tone?: "info" | "safety" | "warning"; children: React.ReactNode }) {
  return <aside className={`article-callout is-${tone}`}>{children}</aside>;
}

/** A hub: every registered page of one kind, as cards. */
/** The on-page heading per hub, written to carry the hub's keyword (docs/seo/seo-plan.json). */
const HUB_H1: Partial<Record<ContentKind, string>> = {
  alternative: "LinkedIn automation tools, compared on what keeps an account safe",
};

export function HubLayout({ kind }: { kind: ContentKind }) {
  const hub = HUBS.find((h) => h.kind === kind);
  if (!hub) throw new Error(`no hub for ${kind}`);
  const pages = contentOfKind(kind);
  return (
    <section className="article hub">
      <BreadcrumbSchema trail={[{ name: "Home", path: "/" }, { name: hub.title, path: hub.path }]} />
      <Json
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: hub.title,
          description: hub.description,
          url: canonical(hub.path),
          mainEntity: {
            "@type": "ItemList",
            itemListElement: pages.map((page, i) => ({ "@type": "ListItem", position: i + 1, url: canonical(page.path), name: page.title })),
          },
        }}
      />
      <header className="article-head">
        <h1>{HUB_H1[kind] ?? hub.title}</h1>
        <p className="article-lede">{hub.description}</p>
      </header>
      <ul className="hub-list">
        {pages.map((page) => (
          <li key={page.path}>
            <Link href={page.path}>
              <strong>{page.title}</strong>
              <span>{page.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function hubMeta(kind: ContentKind): Metadata {
  const hub = HUBS.find((h) => h.kind === kind);
  if (!hub) throw new Error(`no hub for ${kind}`);
  return { ...pageMeta({ title: hub.title, description: hub.description, path: hub.path }), title: { absolute: hub.title } };
}
