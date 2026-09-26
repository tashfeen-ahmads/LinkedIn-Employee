import { describe, expect, it } from "vitest";
import { scoreProspects } from "../src/targeting.js";
import { STRATEGY_SYSTEM, strategyUserPrompt } from "../src/prompts/strategy.js";
import { FIT_SCORE_SYSTEM } from "../src/prompts/targeting.js";
import type { AgentContext } from "../src/client.js";
import type { CustomerProfile, ProspectCandidate } from "@le/shared";

/**
 * Who the agents are told to look for.
 *
 * A business owner activating a campaign wants the people who need what they
 * sell. What the agents produced was the people who do what they do — three
 * live strategies describing peers, and a business profile that listed BNI as a
 * competitor beside a priority-1 customer profile made of BNI chapter
 * presidents.
 *
 * The scorer cannot fix that, and this is the part worth holding on to: it
 * scores each prospect *against the customer profile*, so a peer-shaped profile
 * makes peers high-fit by definition and its own "disqualify competitors" rule
 * is measured against the thing that is wrong. So the instruction has to be in
 * the prompt, and the evidence has to reach the model.
 */

function recordingCtx() {
  const sent: Array<{ system: string; cachedSystem: string; user: string }> = [];
  const ctx = {
    workspaceId: "w",
    client: {
      models: { writer: "w", classifier: "c" },
      complete: async (request: {
        system: Array<{ text: string; cached?: boolean }>;
        user: string;
      }) => {
        sent.push({
          system: request.system.map((s) => s.text).join("\n"),
          cachedSystem: request.system
            .filter((s) => s.cached)
            .map((s) => s.text)
            .join("\n"),
          user: request.user,
        });
        return {
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
          refusal: null,
          incomplete: null,
          parsed: { scores: [] },
        };
      },
    },
    recordCall: async () => {},
  } as unknown as AgentContext;
  return { ctx, sent };
}

const profile = {
  name: "Referral-dependent local professionals",
  summary: "Solo professionals whose new business comes from referrals.",
  jobTitles: ["Realtor"],
  seniority: ["Owner"],
  industries: ["Real Estate"],
  companySize: "1-10",
  geography: ["United States"],
  triggerEvents: [],
  pains: ["They lose half their referrals."],
  valueProposition: "Warm introductions.",
  whatTheyBuy: "A steady flow of partner introductions.",
  insteadOfToday: "A spreadsheet and whoever they remember to call.",
  salesNavFilters: {
    titles: ["Realtor"],
    seniorities: ["Owner"],
    industries: ["Real Estate"],
    companyHeadcount: ["1-10"],
    geographies: ["United States"],
    keywords: ["referrals"],
    excludeTitles: [],
  },
  hooks: ["a", "b", "c"],
  connectionNote: "note",
  followUps: [{ delayDays: 2, message: "one" }],
  priority: 1,
} as unknown as CustomerProfile;

const candidates = [
  {
    providerId: "p1",
    firstName: "A",
    lastName: "Person",
    company: "A Realty",
    title: "Realtor",
    headline: "Realtor at A Realty",
    location: "Austin",
    linkedinUrl: "https://linkedin.com/in/a-person",
  },
] as unknown as ProspectCandidate[];

describe("what the fit scorer is handed", () => {
  it("is told what the segment buys and what they do instead", async () => {
    // Without these it sees a list of titles and an industry — which a
    // competitor matches perfectly, because they sell the same thing to the
    // same people and therefore hold the same titles.
    const { ctx, sent } = recordingCtx();
    await scoreProspects(ctx, { profile, candidates });

    expect(sent[0]?.system).toContain("whatTheyBuy");
    expect(sent[0]?.system).toContain("A steady flow of partner introductions.");
    expect(sent[0]?.system).toContain("A spreadsheet and whoever they remember to call.");
  });

  it("is told what the company sells and who it competes with, when that is known", async () => {
    /*
     * Its rule has always said to disqualify a competitor. Until now it was
     * told nothing whatsoever about the company, so that was a question it had
     * no way to answer — and it answered by matching job titles instead.
     */
    const { ctx, sent } = recordingCtx();
    await scoreProspects(ctx, {
      profile,
      candidates,
      business: { oneLiner: "A referral engine for small firms.", competitors: ["BNI", "LinkedIn"] },
    });

    expect(sent[0]?.system).toContain("A referral engine for small firms.");
    expect(sent[0]?.system).toContain("BNI");
    // In the cached half: it is identical for every batch in the run.
    expect(sent[0]?.cachedSystem).toContain("A referral engine for small firms.");
  });

  it("still runs when no business row was loaded", async () => {
    // One caller has no business profile to hand. A scorer that refused to run
    // without it would stop prospecting in order to gain a hint.
    const { ctx, sent } = recordingCtx();
    await expect(scoreProspects(ctx, { profile, candidates })).resolves.toBeInstanceOf(Array);
    expect(sent[0]?.system).not.toContain("The company you are prospecting for");
  });
});

describe("what the Strategy Agent is asked for", () => {
  it("says a customer profile is somebody who would pay", () => {
    expect(STRATEGY_SYSTEM).toMatch(/SOMEBODY WHO WOULD PAY THIS COMPANY/);
  });

  it("names the trap the website itself sets", () => {
    // The material is the company's own site, and the segments that share a
    // company's worldview are its peers. That has to be said, because it is the
    // easier answer and it looks right.
    expect(STRATEGY_SYSTEM).toMatch(/PEERS AND COMPETITORS/);
    expect(STRATEGY_SYSTEM).toMatch(/competitors` list is a list of who NOT to target/);
  });

  it("asks what the segment does about the problem today", () => {
    expect(STRATEGY_SYSTEM).toMatch(/doing about this today/i);
    expect(STRATEGY_SYSTEM).toContain("insteadOfToday");
  });

  it("keeps a competitor allowed in the pains, where it belongs", () => {
    // "They track it in a spreadsheet" is the reason somebody buys. A rule that
    // banned it would push the agent away from the only concrete thing it knows.
    expect(STRATEGY_SYSTEM).toMatch(/fine and correct for a pain to name a competitor/);
  });

  it("no longer calls existing customers a lookalike", () => {
    /*
     * The word that leaked. "Rank lookalike profiles highest", read against a
     * company's own website, ranks the segments that look like the COMPANY
     * highest — which is how every one of the live strategies came to describe
     * peers.
     */
    const prompt = strategyUserPrompt({ existingCustomers: ["Acme Realty", "Bob's CPA"] });
    expect(prompt).not.toMatch(/lookalike/i);
    expect(prompt).toContain("only certain examples of somebody who pays");
  });

  it("holds the line when it is asked for more segments", () => {
    // Expanding is where a model reaches for novelty, and the nearest novel
    // thing to a company is the people who do what it does.
    const prompt = strategyUserPrompt({
      existingProfiles: [{ name: "Small agencies" }],
      want: 4,
    });
    expect(prompt).toMatch(/would PAY this company/);
  });
});

describe("what the fit scorer is told to do with a competitor", () => {
  it("says a competitor matches an ICP almost perfectly", () => {
    // The reason this needs saying at all: on title match they are the best
    // prospects in the list.
    expect(FIT_SCORE_SYSTEM).toMatch(/matches an ideal customer profile almost perfectly/);
  });

  it("scores for whether they would buy, not whether they resemble", () => {
    expect(FIT_SCORE_SYSTEM).toMatch(/WOULD THIS PERSON BUY IT/);
  });

  it("refuses to pad a list out with competitors", () => {
    // An empty list with reasons is a fixable strategy; a full list of
    // competitors is a restricted LinkedIn account.
    expect(FIT_SCORE_SYSTEM).toMatch(/An empty list with reasons is a fixable strategy/);
  });
});
