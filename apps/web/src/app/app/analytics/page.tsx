import { redirect } from "next/navigation";

/**
 * The old route, kept working.
 *
 * Results and agent spend are sections of the overview now. They were two more
 * tabs holding two more readings of numbers the overview already had, and a
 * person asking "is this working" should not have to know which of three
 * screens to open. The section lives in `analytics-section.tsx`, because Next
 * refuses any export from a `page.tsx` other than the page.
 */
export default async function AnalyticsPage() {
  redirect("/app#results");
}
