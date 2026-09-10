import type { Metadata } from "next";
import { Extras, Faq, FAQ_ITEMS, Hero, HowItWorks, Pricing, Signals } from "@/components/marketing";
import { FaqSchema, SoftwareSchema } from "@/components/schema";
import { SITE, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: `${SITE.tagline} — books meetings while you sleep`,
  description: SITE.description,
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <SoftwareSchema />
      <FaqSchema items={FAQ_ITEMS} />
      <Hero />
      <HowItWorks />
      <Signals />
      <Extras />
      <Pricing />
      <Faq />
    </>
  );
}
