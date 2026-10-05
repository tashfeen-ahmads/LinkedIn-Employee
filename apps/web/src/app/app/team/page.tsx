import { redirect } from "next/navigation";
import { forwardQuery } from "@/lib/forward-query";

/**
 * The old route, kept working.
 *
 * Team, billing and the rep's own details are one screen now: somebody
 * managing a workspace does all three in the same sitting, and three tabs
 * meant three places to find and three saves to remember. Every link,
 * bookmark and email that pointed here still lands somewhere sensible.
 *
 * The query string goes with it. It carries `?error=` and `?notice=` from
 * anything still redirecting here, and the LinkedIn return trip's
 * `connected` and `account_id`; dropping it on the way said every refusal to
 * nobody, and the invitation that was never emailed looked sent.
 *
 * The section itself lives in `profile/team-section.tsx`, because Next
 * refuses any export from a `page.tsx` other than the page.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/app/profile${forwardQuery(await searchParams)}#team`);
}
