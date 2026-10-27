import { PageHeader } from "@/components/page";
import { LimitsSection } from "../limits-section";
import { ResultsSection } from "../analytics-section";

export const dynamic = "force-dynamic";

/**
 * Results: every chart and table, on a page of their own.
 *
 * They used to sit under the overview, which made the screen somebody opens
 * every morning five screens long: a to-do list, four figures, two panels of
 * limits, the day's story, the team, a trend, a funnel, two ranked lists and a
 * table. A business owner asking "is it working" read the first two and
 * scrolled past the rest. The overview keeps the four figures and a link here;
 * the numbers themselves are computed once, in the same functions, so the two
 * pages cannot disagree.
 */
export default async function ResultsPage() {
  return (
    <>
      <PageHeader
        title="Results"
        lede="How your campaigns are doing, and how close your LinkedIn account is to its safe limits."
      />
      <LimitsSection />
      <ResultsSection />
    </>
  );
}
