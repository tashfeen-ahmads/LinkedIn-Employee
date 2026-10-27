import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { TeamSection } from "../team-section";

/**
 * Team: who is on this workspace, and the way to add somebody.
 *
 * The section itself lives in `profile/team-section.tsx`, where its actions
 * are; this route gives it an address of its own in the profile's menu, so an
 * invitation's answer lands beside the list it changed.
 */
export default async function TeamSectionPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <TeamSection />
    </>
  );
}
