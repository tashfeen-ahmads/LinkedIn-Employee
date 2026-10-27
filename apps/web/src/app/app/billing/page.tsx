import { redirect } from "next/navigation";
import { forwardQuery } from "@/lib/forward-query";

/**
 * The old route, kept working.
 *
 * Billing is a section of the profile now (`/app/profile/billing`). Every
 * link, bookmark and email that pointed here still lands on it, with its
 * query string, so a `?checkout=` answer is never dropped on the way.
 *
 * The section itself lives in `profile/billing-section.tsx`, because Next
 * refuses any export from a `page.tsx` other than the page.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/app/profile/billing${forwardQuery(await searchParams)}`);
}
