import { redirect } from "next/navigation";

/**
 * The old route, kept working.
 *
 * Team, billing and the rep's own details are one screen now: somebody
 * managing a workspace does all three in the same sitting, and three tabs
 * meant three places to find and three saves to remember. Every link,
 * bookmark and email that pointed here still lands somewhere sensible.
 *
 * The section itself lives in `profile/team-section.tsx`, because Next
 * refuses any export from a `page.tsx` other than the page.
 */
export default async function TeamPage() {
  redirect("/app/profile#team");
}
