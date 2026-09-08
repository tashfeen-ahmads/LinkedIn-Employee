import { Extras, Faq, Hero, HowItWorks, Pricing, Signals, SiteFooter, SiteHeader } from "@/components/marketing";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <Signals />
        <Extras />
        <Pricing />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
