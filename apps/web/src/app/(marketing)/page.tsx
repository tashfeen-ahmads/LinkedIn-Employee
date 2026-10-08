import type { Metadata } from "next";
import {
  Extras,
  Faq,
  FAQ_ITEMS,
  Film,
  FreeForNow,
  Hero,
  HowItWorks,
  MeetTheTeam,
  Safety,
  Signals,
  TheGate,
  TheSequence,
  Volume,
} from "@/components/marketing";
import { FaqSchema, SoftwareSchema } from "@/components/schema";
import { SITE, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: `${SITE.tagline} that books meetings while you sleep`,
  description: SITE.description,
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <SoftwareSchema />
      <FaqSchema items={FAQ_ITEMS} />
      <Hero />
      <MeetTheTeam />
      <Film />
      <HowItWorks />
      <TheSequence />
      <TheGate />
      <Signals />
      <Safety />
      <Volume />
      <Extras />
      <FreeForNow />
      <Faq />
    </>
  );
}
