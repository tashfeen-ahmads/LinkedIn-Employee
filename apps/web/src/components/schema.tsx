import { PUBLIC_LIMITS, SITE, canonical } from "@/lib/site";
import { BRAND } from "@le/shared";
import { TRIAL_DAYS } from "@/lib/plans";

/**
 * Structured data.
 *
 * This is the part of SEO that is engineering rather than copywriting: a
 * machine-readable statement of what the page is, which is what produces a
 * rich result instead of a blue link. Every claim here has to match what is
 * visible on the page — Google treats a mismatch as spam, and it is also just
 * lying in a format nobody proofreads.
 */
export function Json({ data }: { data: Record<string, unknown> }) {
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
    <>
      {/*
        The site's own name, so a result can read "Nora AI SDR" rather than the
        bare domain. Google takes the site name from WebSite markup.
      */}
      <Json
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: `${SITE.name} AI SDR`,
          alternateName: ["Nora", "Nora SDR", "norasdr.com"],
          url: SITE.url,
        }}
      />
      <Json
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        name: SITE.name,
        // The bare name is shared with a musician, a novel and a dozen
        // companies; these are what people actually type to find this one.
        alternateName: ["Nora SDR", "Nora AI SDR", "norasdr"],
        url: SITE.url,
        description: SITE.description,
        logo: `${SITE.url}/og`,
        parentOrganization: { "@type": "Organization", name: BRAND.maker },
      }}
      />
    </>
  );
}

/**
 * The product itself.
 *
 * One offer at zero, and it is the trial: fourteen days of Autopilot with no
 * card, which is what every public page says. The paid plans are priced on
 * /pricing alone, and structured data must never advertise a price or an
 * offer no reader can find on the screen, which is the mismatch Google treats
 * as spam.
 */
export function SoftwareSchema() {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: SITE.name,
        alternateName: "Nora AI SDR for LinkedIn",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Sales Engagement",
        operatingSystem: "Web",
        url: SITE.url,
        description: SITE.description,
        offers: {
          "@type": "Offer",
          name: `${TRIAL_DAYS}-day free trial of Nora Autopilot`,
          description: `No card needed. After the trial, choose Nora Pro or Nora Autopilot.`,
          price: "0",
          priceCurrency: "USD",
          eligibleDuration: { "@type": "QuantitativeValue", value: TRIAL_DAYS, unitCode: "DAY" },
        },
        featureList: [
          "An AI assistant with four AI employees: a strategist, a prospector, a campaign writer and an outreach and booking specialist",
          "Customer strategies written from your website, approved by you before anything is searched",
          "Ranked prospect lists with the intent signals behind each score",
          `Sending capped at ${PUBLIC_LIMITS.invitesPerDayCeiling} invitations a day and ${PUBLIC_LIMITS.invitesPerWeek} a week`,
          "Replies answered under the rules you set, and an opt-out stops all contact",
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
  image,
}: {
  headline: string;
  description: string;
  path: string;
  published: string;
  modified?: string;
  /** Absolute URL of the article's feature image; defaults to the generic card. */
  image?: string;
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
        image: image ?? `${SITE.url}/og?title=${encodeURIComponent(headline)}`,
      }}
    />
  );
}
