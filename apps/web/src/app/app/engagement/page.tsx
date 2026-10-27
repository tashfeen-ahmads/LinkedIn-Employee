import { redirect } from "next/navigation";
import { forwardQuery } from "@/lib/forward-query";

/**
 * The old Likes and comments page, kept working.
 *
 * Every LinkedIn activity Nora does in the rep's name is switched on and off in
 * one place now, the LinkedIn activity section of the profile, and the list of
 * what was liked and commented on (rule 68) is its Activity log. Links and
 * bookmarks that pointed here land on the section, with their query string.
 */
export default async function EngagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/app/profile/activity${forwardQuery(await searchParams)}`);
}
