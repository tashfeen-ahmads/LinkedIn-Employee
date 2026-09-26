import type { BusinessProfile, CustomerProfile } from "./schemas.js";

/**
 * Whether a segment describes somebody who would buy this, or somebody who
 * sells it.
 *
 * The Strategy Agent reads a company's own website, and a website describes the
 * company's world: its vocabulary, its thesis, the problem it was founded on.
 * Asked for "Customer Profiles" from that material, a model reliably returns
 * the people who *share that worldview* — and the people who share a company's
 * worldview are its peers and competitors. Its customers are the ones with the
 * problem it solves, which is a different set and reads almost identically on
 * screen.
 *
 * This deployment did it in one response. The business profile listed
 * `competitors: ["LinkedIn", "BNI and traditional in-person networking groups",
 * "Manual referral tracking"]` and the top-priority customer profile, which a
 * person then approved, was "Networking group leaders & organizations (BNI
 * chapters, Chambers, masterminds)". The same run named BNI a competitor and
 * made BNI chapter presidents the segment to pursue first. Nothing anywhere
 * compared the two fields.
 *
 * The fit scorer cannot catch it, and this is the part worth understanding: it
 * scores each prospect *against the customer profile*, so a segment shaped like
 * a competitor makes competitors high-fit by definition. Its own
 * "disqualify competitors" rule is measured against the very thing that is
 * wrong. A bad strategy is not a strategy the filter can rescue — it is the
 * filter's definition of good.
 *
 * So the comparison happens here, before anybody approves anything.
 *
 * It **reports and never refuses.** Selling a white-label engine to the
 * chambers you also compete with is a real go-to-market, and a check that
 * blocked it would be wrong about a business it knows nothing about. What is
 * never acceptable is that it was approved without anybody being told — which
 * is rule 12's principle exactly: a filter that silently becomes a suggestion
 * is worse than one that is missing.
 */

/**
 * Where a competitor's name may and may not appear.
 *
 * Only the fields that say *who this segment is*. A competitor named in `pains`
 * is not a mistake, it is the point — "they run their referrals on
 * spreadsheets" is precisely why somebody would buy a referral engine, and a
 * check that flagged it would train people to approve past it. The distinction
 * is the whole reason this is worth writing down: naming what a segment uses
 * today is targeting by need, and naming a segment *as* that thing is
 * targeting by resemblance.
 */
function identityText(profile: CustomerProfile): string {
  return [
    profile.name,
    ...profile.jobTitles,
    ...profile.industries,
    ...profile.salesNavFilters.titles,
    ...profile.salesNavFilters.industries,
    ...profile.salesNavFilters.keywords,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Words too common to identify anybody, plus the ones a competitor entry
 * begins with when it is a description rather than a name.
 *
 * "Manual referral tracking (spreadsheets)" is capitalised only because it
 * starts the sentence, and treating `Manual` as a brand would flag every
 * segment that mentions manual work — which is most of them, correctly.
 */
const NOT_A_NAME = new Set([
  "manual",
  "traditional",
  "legacy",
  "generic",
  "other",
  "various",
  "several",
  "some",
  "large",
  "small",
  "local",
  "online",
  "offline",
  "in-house",
  "internal",
  "external",
  "diy",
  "spreadsheets",
  "spreadsheet",
  "email",
  "the",
  "and",
  "for",
  "with",
]);

/** A word shaped like a name: `BNI`, `LinkedIn`, `HubSpot`, `Cal.com`. */
const NAMELIKE = /^[A-Z][A-Za-z0-9.&+-]{2,}$/;

/**
 * The competitors named by name, as lowercase tokens.
 *
 * Capitalisation is the signal, because a competitor list mixes two kinds of
 * entry — brands and descriptions — and only the brands identify a segment.
 * A brand word is also dropped when it is part of how the company describes
 * *itself*: "networking" in a competitor entry is not evidence of anything when
 * the company's own one-liner calls it a networking platform.
 */
export function namedCompetitors(business: BusinessProfile): string[] {
  const own = new Set(
    `${business.companyName} ${business.oneLiner} ${business.offering}`
      .toLowerCase()
      .split(/[^a-z0-9.&+-]+/)
      .filter(Boolean),
  );

  const names = new Set<string>();
  for (const entry of business.competitors) {
    for (const raw of entry.split(/[^A-Za-z0-9.&+-]+/)) {
      if (!NAMELIKE.test(raw)) continue;
      const token = raw.toLowerCase();
      if (NOT_A_NAME.has(token) || own.has(token)) continue;
      names.add(token);
    }
  }
  return [...names];
}

export interface CompetitorTargeting {
  /** The competitor names this segment identifies itself by. */
  names: string[];
  /** The competitor entries they came from, for the sentence on the screen. */
  entries: string[];
}

/**
 * Which of this company's own named competitors this segment is made of.
 *
 * Empty is the ordinary answer. A non-empty one is a question for whoever is
 * approving — never an answer, and never a refusal.
 */
export function competitorTargeting(
  profile: CustomerProfile,
  business: BusinessProfile,
): CompetitorTargeting {
  const haystack = identityText(profile);
  const names = namedCompetitors(business).filter((name) =>
    // Word-bounded, or "Cal" matches "calendar" and "BNI" matches nothing
    // useful at all. Built per name rather than once, because the names come
    // from a model and may contain regex metacharacters.
    new RegExp(`(^|[^a-z0-9])${escapeRegex(name)}([^a-z0-9]|$)`).test(haystack),
  );

  return {
    names,
    entries: names.length
      ? business.competitors.filter((entry) => {
          const lower = entry.toLowerCase();
          return names.some((name) => lower.includes(name));
        })
      : [],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The sentence shown beside a segment on the approval screen.
 *
 * Phrased as a question because it is one. The answer "yes, we white-label to
 * them" is legitimate and common, and the cost of asking is that somebody reads
 * one line — against the cost of not asking, which is a campaign that spends a
 * capped daily invitation allowance introducing a company to its own
 * competitors under a real rep's name.
 */
export function describeCompetitorTargeting(found: CompetitorTargeting): string | null {
  if (!found.names.length) return null;
  const listed = found.entries.length ? found.entries : found.names;
  return `This segment is defined by ${found.names.length === 1 ? "a competitor" : "competitors"} you listed: ${listed.join("; ")}. If you sell to them, that is fine — approve it. If you meant the people who need what they do, rewrite the titles and industries before approving.`;
}
