import type { Metadata } from "next";
import { Faq, FAQ_ITEMS } from "@/components/marketing";
import { Decisions, Hero, Notes, Replies, SafetyBento } from "@/components/home";
import { FaqSchema, SoftwareSchema } from "@/components/schema";
import { SITE, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Nora: AI SDR for LinkedIn built to keep your account safe",
  description: SITE.description,
  path: "/",
});

/*
 * Seven sections, in the order a buyer asks: what it is, what is left for
 * them to do, whether it will sound like them, whether it will cost them the
 * account, what happens when somebody answers, the questions people ask
 * first, and the one ask (the closing band, from the layout).
 */
export default function HomePage() {
  return (
    <>
      <SoftwareSchema />
      <FaqSchema items={FAQ_ITEMS} />
      <Hero />
      <Decisions />
      <Notes />
      <SafetyBento />
      <Replies />
      <Faq eyebrow="FAQ" id="faq" />
    </>
  );
}
