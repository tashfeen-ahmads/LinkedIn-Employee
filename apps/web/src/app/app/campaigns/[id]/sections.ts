/**
 * The parts of a campaign, each its own section with its own address.
 *
 * A campaign was one page scrolled from top to bottom: the pacing, the funnel,
 * the goal, the copy, four hundred names, the angles and the settings, stacked
 * in that order, and whoever opened it had to find the part they came for.
 * Each part is now a route under the campaign, listed in the side menu, so a
 * person goes to the part rather than looking for it.
 *
 * One list, read by the menu, by every server action's redirect (so a save on
 * People lands back on People with its notice) and by the setup gate's test
 * (so a section added here is reachable during setup, rule 65).
 */
export const CAMPAIGN_SECTIONS = [
  { slug: "", title: "Overview" },
  { slug: "goal", title: "Goal & link" },
  { slug: "people", title: "People" },
  { slug: "opener", title: "Opener & offer" },
  { slug: "follow-ups", title: "Follow-ups" },
  { slug: "replies", title: "Replies" },
  { slug: "settings", title: "Settings" },
] as const;

export type CampaignSection = (typeof CAMPAIGN_SECTIONS)[number]["slug"];

/** The address of one section of one campaign. Overview is the campaign's own address. */
export function sectionHref(campaignId: string, section: CampaignSection = ""): string {
  return section ? `/app/campaigns/${campaignId}/${section}` : `/app/campaigns/${campaignId}`;
}

/**
 * A section named by a form, or the overview.
 *
 * The form's word is a claim like any other field, so only a slug on the list
 * above is honoured: anything else lands on the overview rather than building
 * an address out of whatever was posted.
 */
export function sectionFrom(value: unknown): CampaignSection {
  const slug = typeof value === "string" ? value : "";
  return CAMPAIGN_SECTIONS.some((section) => section.slug === slug) ? (slug as CampaignSection) : "";
}
