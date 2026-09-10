import { SiteFooter, SiteHeader } from "@/components/marketing";

/** Every public page wears the same header and footer. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
