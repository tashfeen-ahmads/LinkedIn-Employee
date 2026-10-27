import { redirect } from "next/navigation";
import { forwardQuery } from "@/lib/forward-query";

/**
 * The old route, kept working.
 *
 * Team is a section of the profile now (`/app/profile/team`): somebody
 * managing a workspace sets up who is on it, what it costs and how the agent
 * behaves in one sitting, and three tabs meant three places to find. Every
 * link, bookmark and email that pointed here still lands on the team.
 *
 * The query string goes with it. It carries `?error=` and `?notice=` from
 * anything still redirecting here; dropping it on the way said every refusal
 * to nobody, and the invitation that was never emailed looked sent.
 *
 * The section itself lives in `profile/team-section.tsx`, because Next
 * refuses any export from a `page.tsx` other than the page.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/app/profile/team${forwardQuery(await searchParams)}`);
}
