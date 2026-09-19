import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/site";
import { OrganizationSchema } from "@/components/schema";

/*
 * Three faces, each with a job.
 *
 * Loaded through next/font so they are self-hosted and subset at build time:
 * no request to a font CDN on someone else's page load, and no flash of
 * fallback text while a headline arrives.
 */

/** Headlines. A grotesque with enough character to not read as a default. */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-bricolage",
  display: "swap",
});

/** Everything read as prose or interface. */
const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

/*
 * The application wears a different face from the marketing site, on purpose.
 *
 * A landing page is read once and wants character; a dashboard is worked in
 * every day and wants to disappear. Instrument Sans and Bricolage were chosen
 * for the first job and were doing the second badly — the app inherited a
 * headline scale it then had to patch back down, which is where the "titles
 * under titles" came from.
 *
 * Geist is a tool face: narrow enough to fit a dense table, with real tabular
 * figures so a column of numbers lines up without being set in a monospace.
 * Its mono companion carries ids, tokens and anything that has to be read
 * character by character.
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
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: SITE.url },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: SITE.locale,
    url: SITE.url,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    images: [{ url: `${SITE.url}/og`, width: 1200, height: 630, alt: SITE.tagline }],
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
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
      className={`${bricolage.variable} ${instrument.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body>
        <OrganizationSchema />
        {children}
      </body>
    </html>
  );
}
