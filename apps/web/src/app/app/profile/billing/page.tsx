import { PageNotice } from "@/components/page-notice";
import { BillingSection } from "../billing-section";

/**
 * Billing: the workspace's plan, and its data.
 *
 * Stripe's checkout and billing portal return here (`?checkout=`), and the
 * export and import routes answer here, so every one of those answers is said
 * beside the plan it is about.
 */
export default async function BillingSectionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; checkout?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <BillingSection checkout={params.checkout} />
    </>
  );
}
