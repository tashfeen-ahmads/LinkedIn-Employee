import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/site";
import { OrganizationSchema } from "@/components/schema";

/*
 * One family, loaded through next/font so it is self-hosted and subset at
 * build time: no request to a font CDN on someone else's page load.
 *
 * Geist is a tool face with real tabular figures, which the dashboard needs
 * and the marketing pages, full of the limits the product enforces, need too.
 * Its mono companion carries ids, tokens and anything read character by
 * character.
 */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  // Every page supplies its own title; this is the frame around it, so no page
  // ever ships with the bare site name as its only title.
  // Core pages name the product in their own titles; articles set theirs
  // absolutely, because a suffix pushes a keyword-first title past 60 characters.
  title: { default: `${SITE.name} | ${SITE.tagline}`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: {
    canonical: SITE.url,
    // Advertised on every page so readers and crawlers can find the feed.
    types: { "application/rss+xml": `${SITE.url}/feed.xml` },
  },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: SITE.locale,
    url: SITE.url,
    title: `${SITE.name} | ${SITE.tagline}`,
    description: SITE.description,
    images: [{ url: `${SITE.url}/og`, width: 1200, height: 630, alt: SITE.tagline }],
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  /*
   * Search console ownership, set from the deployment's environment so the
   * token is never committed. Unset, nothing is rendered.
   */
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
      : undefined,
  },
};

/*
 * The browser's own chrome — the address bar on a phone, the status bar —
 * takes the page's ground rather than a default white band above it. Light
 * only, matching the stamped theme below.
 */
export const viewport: Viewport = {
  themeColor: "#F4F5F9",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Stamped light rather than following the visitor's system. The dark palette
    // is still defined in globals.css behind :root[data-theme="dark"], so a
    // toggle is a one-line change from here — but the site ships light, on
    // purpose, rather than becoming a different product on someone's laptop.
    <html
      lang="en"
      data-theme="light"
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <body>
        <OrganizationSchema />
        {children}
      </body>
    </html>
  );
}
