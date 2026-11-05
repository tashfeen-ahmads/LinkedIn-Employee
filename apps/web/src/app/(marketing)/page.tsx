import type { Metadata } from "next";
import { Faq, FAQ_ITEMS } from "@/components/marketing";
import { Decisions, Hero, Notes, Presence, Replies, SafetyBento, SalesNavigator } from "@/components/home";
import { FaqSchema, SoftwareSchema } from "@/components/schema";
import { SITE, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Nora: AI SDR that books meetings from LinkedIn for you",
  description: SITE.description,
  path: "/",
});

/*
 * Nine sections, in the order a buyer asks: what it is, what is left for
 * them to do, whether it works with the search they already pay for, whether
 * it will sound like them, whether it will cost them the
 * account, what happens when somebody answers, what it keeps doing between
 * conversations, the questions people ask first, and the one ask (the
 * closing band, from the layout).
 */
export default function HomePage() {
  return (
    <>
      <SoftwareSchema />
      <FaqSchema items={FAQ_ITEMS} />
      <Hero />
      <Decisions />
      <SalesNavigator />
      <Notes />
      <SafetyBento />
      <Replies />
      <Presence />
      <Faq eyebrow="FAQ" id="faq" />
    </>
  );
}
