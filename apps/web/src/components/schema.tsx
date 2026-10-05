import { PUBLIC_LIMITS, SITE, canonical } from "@/lib/site";

/**
 * Structured data.
 *
 * This is the part of SEO that is engineering rather than copywriting: a
 * machine-readable statement of what the page is, which is what produces a
 * rich result instead of a blue link. Every claim here has to match what is
 * visible on the page — Google treats a mismatch as spam, and it is also just
 * lying in a format nobody proofreads.
 */
function Json({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // The content is our own object, not user input, and JSON.stringify with
      // the closing-tag escape is the documented way to embed it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function OrganizationSchema() {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        logo: `${SITE.url}/og`,
      }}
    />
  );
}

/**
 * The product itself.
 *
 * One offer at zero, because that is what the page says: free for everyone,
 * for now. The three priced plans this used to carry were removed from every
 * visible page, and structured data that still advertised them would be the
 * mismatch Google treats as spam — a price in the markup that no reader can
 * find on the screen.
 */
export function SoftwareSchema() {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: SITE.name,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Sales Engagement",
        operatingSystem: "Web",
        url: SITE.url,
        description: SITE.description,
        offers: {
          "@type": "Offer",
          name: "Free for everyone, for now",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: [
          "An AI assistant with four AI employees: a strategist, a prospector, a campaign writer and an outreach and booking specialist",
          "Customer strategies written from your website, approved by you before anything is searched",
          "Ranked prospect lists with the intent signals behind each score",
          `Sending capped at ${PUBLIC_LIMITS.invitesPerDayMax} invitations a day and ${PUBLIC_LIMITS.invitesPerWeek} a week`,
          "Replies drafted for human approval",
          "Meetings booked from times you are actually available",
        ],
      }}
    />
  );
}

/** Questions and answers, matched word for word to what the page shows. */
export function FaqSchema({ items }: { items: ReadonlyArray<{ q: string; a: string }> }) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      }}
    />
  );
}

/** The trail a reader took to get here, which is what shows under the title. */
export function BreadcrumbSchema({ trail }: { trail: ReadonlyArray<{ name: string; path: string }> }) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: trail.map((step, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: step.name,
          item: canonical(step.path),
        })),
      }}
    />
  );
}

/** A long-form guide, so it can qualify as an article rather than a page. */
export function ArticleSchema({
  headline,
  description,
  path,
  published,
  modified,
}: {
  headline: string;
  description: string;
  path: string;
  published: string;
  modified?: string;
}) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline,
        description,
        mainEntityOfPage: { "@type": "WebPage", "@id": canonical(path) },
        datePublished: published,
        dateModified: modified ?? published,
        author: { "@type": "Organization", name: SITE.name, url: SITE.url },
        publisher: { "@type": "Organization", name: SITE.name, url: SITE.url },
        image: `${SITE.url}/og?title=${encodeURIComponent(headline)}`,
      }}
    />
  );
}
