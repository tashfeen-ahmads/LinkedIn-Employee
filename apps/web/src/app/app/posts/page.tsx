import { redirect } from "next/navigation";
import { forwardQuery } from "@/lib/forward-query";

/**
 * The old Profile posts page, kept working.
 *
 * Posts are one of the LinkedIn activities, so they live beside the others in
 * the profile's LinkedIn activity section (`/app/profile/activity/posts`),
 * where every approval and edit now happens. Links and bookmarks that pointed
 * here land there, with their query string.
 */
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/app/profile/activity/posts${forwardQuery(await searchParams)}`);
}
