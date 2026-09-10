import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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

/** Numbers, labels and anything that has to line up in a column. */
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LinkedIn Employee — your AI SDR for LinkedIn",
  description:
    "Finds your buyers on LinkedIn, starts the conversation, and books the meeting. You show up and close.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
