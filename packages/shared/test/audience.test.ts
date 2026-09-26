import { describe, expect, it } from "vitest";
import {
  competitorTargeting,
  describeCompetitorTargeting,
  namedCompetitors,
} from "../src/audience.js";
import type { BusinessProfile, CustomerProfile } from "../src/schemas.js";

/**
 * Is this segment somebody who would pay, or somebody who sells the same thing?
 *
 * The fixtures below are the real rows from the first live workspace, because
 * this is not a hypothetical failure. That run listed BNI as a competitor and
 * made BNI chapter presidents the priority-1 customer profile, and a person
 * approved it. Nothing compared the two fields.
 */

const BUSINESS: BusinessProfile = {
  companyName: "Referral Nova",
  oneLiner:
    "An AI-powered referral networking platform that matches small businesses, solo professionals and networking groups with complementary partners and delivers warm, trackable introductions.",
  offering: "Matching, warm introductions, Zoom booking and referral tracking.",
  pricingModel: "unknown",
  proofPoints: ["+300% introductions"],
  toneOfVoice: "plain, direct",
  competitors: [
    "LinkedIn (social network for connections)",
    "BNI and traditional in-person networking groups",
    "Manual referral tracking (spreadsheets / referral sheets)",
  ],
  commonObjections: [],
  differentiators: [],
};

function profile(over: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    name: "Referral-dependent local professionals",
    summary: "Solo professionals whose new business comes from referrals.",
    jobTitles: ["Realtor", "Mortgage Broker", "CPA"],
    seniority: ["Owner"],
    industries: ["Real Estate", "Financial Services"],
    companySize: "1-10",
    geography: ["United States"],
    triggerEvents: [],
    pains: ["They track referrals in a spreadsheet and lose half of them."],
    valueProposition: "Warm introductions to complementary partners.",
    whatTheyBuy: "A steady flow of partner introductions.",
    insteadOfToday: "A spreadsheet and whoever they remember to call.",
    salesNavFilters: {
      titles: ["Realtor"],
      seniorities: ["Owner"],
      industries: ["Real Estate"],
      companyHeadcount: ["1-10"],
      geographies: ["United States"],
      keywords: ["referrals", "warm introductions"],
      excludeTitles: [],
    },
    hooks: ["a", "b", "c"],
    connectionNote: "note",
    followUps: [
      { delayDays: 2, message: "one" },
      { delayDays: 5, message: "two" },
    ],
    priority: 1,
    ...over,
  };
}

describe("namedCompetitors", () => {
  it("picks out the ones named by name", () => {
    expect(namedCompetitors(BUSINESS)).toContain("bni");
    expect(namedCompetitors(BUSINESS)).toContain("linkedin");
  });

  it("ignores a word that is only capitalised because it starts the sentence", () => {
    /*
     * "Manual referral tracking (spreadsheets)" is a description, not a brand.
     * Treated as one, every segment that mentions manual work would be flagged
     * — which is most of them, and correctly, because manual work is what they
     * are buying their way out of.
     */
    expect(namedCompetitors(BUSINESS)).not.toContain("manual");
    expect(namedCompetitors(BUSINESS)).not.toContain("spreadsheets");
  });

  it("ignores the company's own vocabulary", () => {
    /*
     * A competitor entry written as "Referral spreadsheets" puts the company's
     * own central noun in name position, capitalised. Taken as a brand it
     * matches every segment this business could ever have — they all say
     * "referral", because that is what the company sells.
     */
    const business = { ...BUSINESS, competitors: ["Referral spreadsheets", "Networking events"] };
    expect(namedCompetitors(business)).not.toContain("referral");
    expect(namedCompetitors(business)).not.toContain("networking");

    // And the segment that says it is therefore left alone.
    expect(competitorTargeting(profile(), business).names).toEqual([]);
  });
});

describe("competitorTargeting", () => {
  it("catches the segment this deployment actually approved", () => {
    // Priority 1, approved by a person, in a run that had just called BNI a
    // competitor two fields earlier.
    const found = competitorTargeting(
      profile({
        name: "Networking group leaders & organizations (BNI chapters, Chambers, masterminds)",
        jobTitles: ["Chapter President", "BNI Chapter President", "Membership Director"],
      }),
      BUSINESS,
    );

    expect(found.names).toEqual(["bni"]);
    expect(found.entries).toEqual(["BNI and traditional in-person networking groups"]);
  });

  it("leaves an ordinary segment alone", () => {
    expect(competitorTargeting(profile(), BUSINESS).names).toEqual([]);
  });

  it("does not flag a competitor named as the thing they do today", () => {
    /*
     * The distinction the whole check rests on. "They track it in a spreadsheet"
     * is not a mistake, it is the reason somebody buys — and a check that
     * flagged it would teach people to click past this warning, which is worse
     * than not having one.
     */
    const found = competitorTargeting(
      profile({
        pains: ["They run the whole thing on LinkedIn and a BNI meeting once a week."],
        summary: "Professionals whose referral habit is LinkedIn plus a BNI chapter.",
      }),
      BUSINESS,
    );
    expect(found.names).toEqual([]);
  });

  it("matches on whole words only", () => {
    /*
     * A short product name inside a longer ordinary word is a different word,
     * and the pair that makes this concrete is real: "Cal" is a scheduling
     * product somebody would list as a competitor, and "local" is one of the
     * most common keywords a small-business segment carries. A substring match
     * flags every local business in the country.
     */
    const business = { ...BUSINESS, competitors: ["Cal", "Calendly"] };
    expect(
      competitorTargeting(
        profile({
          salesNavFilters: { ...profile().salesNavFilters, keywords: ["local clients"] },
        }),
        business,
      ).names,
    ).toEqual([]);

    // The same name, as its own word, does match.
    expect(
      competitorTargeting(
        profile({ salesNavFilters: { ...profile().salesNavFilters, keywords: ["Cal power users"] } }),
        business,
      ).names,
    ).toEqual(["cal"]);
  });

  it("survives a competitor name a model wrote with regex characters in it", () => {
    // These strings come from a language model, so they contain whatever it
    // felt like writing. A thrown exception here takes down the approval screen.
    const business = { ...BUSINESS, competitors: ["C++ (Consulting) [legacy]", "A*Star"] };
    expect(() => competitorTargeting(profile(), business)).not.toThrow();
  });

  it("says nothing at all when a business profile lists no competitors", () => {
    expect(competitorTargeting(profile(), { ...BUSINESS, competitors: [] }).names).toEqual([]);
  });
});

describe("describeCompetitorTargeting", () => {
  it("asks rather than refuses", () => {
    /*
     * Licensing a white-label engine to the chambers you also compete with is a
     * real go-to-market, and a check that blocked it would be wrong about a
     * business it knows nothing about. What is unacceptable is approving it
     * without being told.
     */
    const said = describeCompetitorTargeting(
      competitorTargeting(
        profile({ name: "BNI chapter presidents", jobTitles: ["BNI Chapter President"] }),
        BUSINESS,
      ),
    );
    expect(said).toContain("BNI and traditional in-person networking groups");
    expect(said).toContain("If you sell to them, that is fine");
  });

  it("says nothing when there is nothing to say", () => {
    expect(describeCompetitorTargeting(competitorTargeting(profile(), BUSINESS))).toBeNull();
  });
});

describe("reading a strategy written before these questions were asked", () => {
  it("does not refuse one, and does not pretend it answered", async () => {
    /*
     * `targeting.ts` parses a stored spec, and it used to do it with a bare
     * `.parse()`. A new required key would therefore have thrown on all seven
     * strategies this deployment already had — stopping prospecting on every
     * workspace at once to gain a field.
     *
     * A backfill alone would not have been enough either: between the migration
     * and the deploy, old code writes an old-shaped row that new code refuses to
     * read. Defaulting at the read closes both, for ever.
     */
    const { parseCustomerProfile } = await import("../src/schemas.js");
    const old = { ...profile() } as Record<string, unknown>;
    delete old.whatTheyBuy;
    delete old.insteadOfToday;

    const parsed = parseCustomerProfile(old);
    expect(parsed.success).toBe(true);
    // Null, so the screen can say "the agent did not say" rather than render a
    // blank that reads as agreement.
    expect(parsed.success && parsed.data.whatTheyBuy).toBeNull();
    expect(parsed.success && parsed.data.insteadOfToday).toBeNull();
  });

  it("never overwrites an answer that is there", async () => {
    const { parseCustomerProfile } = await import("../src/schemas.js");
    const parsed = parseCustomerProfile(profile({ whatTheyBuy: "partner introductions" }));
    expect(parsed.success && parsed.data.whatTheyBuy).toBe("partner introductions");
  });

  it("still refuses a spec that is genuinely wrong", async () => {
    // The tolerance is for two known-absent keys, not a licence to read anything.
    const { parseCustomerProfile } = await import("../src/schemas.js");
    expect(parseCustomerProfile({ name: "only a name" }).success).toBe(false);
    expect(parseCustomerProfile(null).success).toBe(false);
    expect(parseCustomerProfile("a string").success).toBe(false);
  });
});
