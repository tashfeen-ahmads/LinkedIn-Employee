import { describe, expect, it } from "vitest";
import { buildCampaign, personalizeInvites } from "../src/targeting.js";
import { reviseForVoice } from "../src/revise.js";
import { CAMPAIGN_SYSTEM, INVITE_NOTE_SYSTEM } from "../src/prompts/targeting.js";
import type { AgentContext } from "../src/client.js";
import type { BusinessProfile, CampaignPlan, CustomerProfile } from "@le/shared";

/*
 * The live workspace these come from (Freelancer, October 2026): an opener
 * approved for founders opened invitations to recruiters, the CTA label went
 * into the last step and the campaign name in title case, and step 2 offered
 * "a two sentence example" that nothing could hand over. Each writer now
 * checks for these in code and rewrites once, told what was wrong.
 */

function scriptedCtx(parses: unknown[]) {
  const users: string[] = [];
  const systems: string[] = [];
  const ctx = {
    workspaceId: "w",
    client: {
      models: { writer: "w", classifier: "c" },
      complete: async (request: { user: string; system: Array<{ text: string }> }) => {
        users.push(request.user);
        systems.push(request.system.map((block) => block.text).join("\n\n"));
        const parsed = parses[Math.min(users.length - 1, parses.length - 1)];
        return { usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, refusal: null, incomplete: null, parsed };
      },
    },
    recordCall: async () => {},
  } as unknown as AgentContext;
  return { ctx, users, systems };
}

const business: BusinessProfile = {
  companyName: "Freelancer",
  oneLiner: "We run outbound for small B2B teams.",
  offering: "Outbound as a service.",
  differentiators: [],
  proofPoints: [],
  competitors: [],
  pricingModel: "unknown",
  toneOfVoice: "plain",
  commonObjections: [],
};

const profile = {
  name: "Staffing agency owners",
  summary: "Owners of small staffing agencies.",
  jobTitles: ["Owner"],
  seniority: ["Owner"],
  industries: ["Staffing and Recruiting"],
  companySize: "1-50",
  geography: ["United States"],
  triggerEvents: [],
  pains: ["Client acquisition is founder-led."],
  valueProposition: "New clients without the owner prospecting.",
  whatTheyBuy: "Outbound.",
  insteadOfToday: "The owner's network.",
  salesNavFilters: {
    titles: ["Owner"],
    seniorities: ["Owner"],
    industries: [],
    companyHeadcount: [],
    geographies: [],
    keywords: [],
    excludeTitles: [],
  },
  hooks: ["Are new clients still coming mostly from your own network?"],
  connectionNote: "note",
  followUps: [{ delayDays: 2, message: "one" }],
  priority: 1,
} as unknown as CustomerProfile;

const FOUNDERS_OPENER =
  "Quick yes or no: do founders still run outbound at your company, or do you have an SDR team?";
const LABEL = "Book a Free Consultation";

function plan(step2: string, step3: string, name = "Staffing owners"): CampaignPlan {
  const steps = [
    { kind: "follow_up" as const, delayDays: 1, message: "Hi {{first_name}}, thanks for connecting. Still placing ops roles?" },
    { kind: "follow_up" as const, delayDays: 3, message: step2 },
    { kind: "follow_up" as const, delayDays: 4, message: step3 },
  ];
  const variantSteps = steps.map(({ delayDays, message }) => ({ delayDays, message }));
  return {
    name,
    connectionNote: "Hi {{first_name}}, I work with a few staffing owners. Would be good to connect.",
    variants: [
      { name: "A", angle: "a", painPoint: null, connectionNote: "Hi, would be good to connect.", steps: variantSteps },
      { name: "B", angle: "b", painPoint: null, connectionNote: "Hi, would be good to connect.", steps: variantSteps },
    ],
    steps,
    stopConditions: [],
    dailyInviteCap: 10,
  };
}

const CLEAN_STEP2 = "Most owners I talk to still sell every new client themselves. Is that you too?";
const CLEAN_ASK = "If it's worth a look, happy to grab 20 minutes? {{cta_link}}";

describe("the campaign writer and its call to action", () => {
  const input = {
    business,
    profile,
    repName: "Rep",
    dailyInviteCap: 10,
    cta: { kind: "link" as const, label: LABEL, url: "https://cal.example.com/consult" },
  };

  it("is told the label is a button's name, never to name it as the label", async () => {
    const { ctx, systems } = scriptedCtx([plan(CLEAN_STEP2, CLEAN_ASK)]);
    await buildCampaign(ctx, input);
    expect(systems[0]).not.toMatch(/Name it as/);
    expect(systems[0]).toMatch(/button's name/);
    expect(CAMPAIGN_SYSTEM).toMatch(/never in Title Case/i);
  });

  it("writes in the voice the rep gave the agent, after the shipped rules", async () => {
    const { ctx, systems } = scriptedCtx([plan(CLEAN_STEP2, CLEAN_ASK)]);
    await buildCampaign(ctx, { ...input, voice: "How this workspace wants you to write:\nI ran a staffing desk for ten years." });
    expect(systems[0]).toContain("I ran a staffing desk for ten years.");
    expect(systems[0]!.indexOf("I ran a staffing desk")).toBeGreaterThan(systems[0]!.indexOf("You write LinkedIn prospecting campaigns"));
  });

  it("sends a title-case label back to be rewritten, and keeps the plain ask", async () => {
    const { ctx, users } = scriptedCtx([
      plan(CLEAN_STEP2, `If yes, ${LABEL} and pick a time: {{cta_link}}`),
      plan(CLEAN_STEP2, CLEAN_ASK),
    ]);
    const out = await buildCampaign(ctx, input);
    expect(users).toHaveLength(2);
    expect(users[1]).toMatch(/title case/);
    expect(out.steps[2]!.message).toBe(CLEAN_ASK);
    expect(out.voiceProblems).toEqual([]);
  });

  it("never keeps the call to action in the campaign's name", async () => {
    const { ctx } = scriptedCtx([plan(CLEAN_STEP2, CLEAN_ASK, `Staffing owners (${LABEL})`)]);
    const out = await buildCampaign(ctx, input);
    expect(out.name).toBe("Staffing owners");
  });
});

describe("the campaign writer and offers it cannot keep", () => {
  const offer = "Hi {{first_name}}, want a two sentence example you can try this week?";
  const base = {
    business,
    profile,
    repName: "Rep",
    dailyInviteCap: 10,
    cta: { kind: "meeting" as const, label: null, url: null },
  };

  it("sends an offer of an example nobody has back to be rewritten", async () => {
    const { ctx, users, systems } = scriptedCtx([plan(offer, "Worth a short call?"), plan(CLEAN_STEP2, "Worth a short call?")]);
    const out = await buildCampaign(ctx, base);
    expect(systems[0]).toMatch(/What exists to send: nothing/);
    expect(users).toHaveLength(2);
    expect(users[1]).toMatch(/offers an example that does not exist/);
    expect(out.steps[1]!.message).toBe(CLEAN_STEP2);
  });

  it("lets the offer stand when the knowledge base has it", async () => {
    const { ctx, users, systems } = scriptedCtx([plan(offer, "Worth a short call?")]);
    const out = await buildCampaign(ctx, { ...base, assets: ["Two sentence outbound examples"] });
    expect(systems[0]).toMatch(/Two sentence outbound examples/);
    expect(users).toHaveLength(1);
    expect(out.voiceProblems).toEqual([]);
  });
});

describe("invite notes and openers written for other people", () => {
  const prospect = {
    providerId: "p1",
    firstName: "Maria",
    lastName: "Lopez",
    headline: "Owner at Lopez Staffing",
    title: "Owner",
    company: "Lopez Staffing",
  };
  const input = {
    business,
    profile,
    repName: "Rep",
    campaignAngle: "founder-led sales",
    hooks: profile.hooks,
    otherOpeners: [FOUNDERS_OPENER],
    prospects: [prospect] as never,
  };
  const note = (text: string) => ({ notes: [{ providerId: "p1", note: text, grounding: ["Owner at Lopez Staffing"], tooThin: false }] });

  it("hands the agent's openers over as optional and tells the writer when to ignore them", async () => {
    const { ctx, systems } = scriptedCtx([note("Hi Maria, you run a staffing agency. Are new clients still mostly referrals?")]);
    await personalizeInvites(ctx, input);
    expect(systems[0]).toMatch(/otherApprovedOpeners/);
    expect(systems[0]).toContain(FOUNDERS_OPENER);
    expect(INVITE_NOTE_SYSTEM).toMatch(/only if its question plainly applies/);
  });

  it("rewrites the founders question that went to a recruiter", async () => {
    const { ctx, users } = scriptedCtx([
      note("Quick yes or no Maria: do founders still run outbound where you hire"),
      note("Hi Maria, you run a staffing agency. Are new clients still mostly referrals?"),
    ]);
    const out = await personalizeInvites(ctx, input);
    expect(users).toHaveLength(2);
    expect(users[1]).toMatch(/different audience/);
    expect(out.get("p1")?.note).toMatch(/staffing agency/);
  });

  it("leaves the note out when the rewrite still pastes an opener, so the angle's note goes", async () => {
    const pasted = note(`Hi Maria. ${profile.hooks[0]}`);
    const { ctx } = scriptedCtx([pasted, pasted]);
    const out = await personalizeInvites(ctx, input);
    expect(out.has("p1")).toBe(false);
  });

  it("refuses a note that offers to send something", async () => {
    const { ctx, users } = scriptedCtx([
      note("Hi Maria, can I send a quick checklist for staffing owners?"),
      note("Hi Maria, you run a staffing agency. Are new clients still mostly referrals?"),
    ]);
    await personalizeInvites(ctx, input);
    expect(users[1]).toMatch(/checklist/);
  });
});

describe("reviseForVoice and the new checks", () => {
  it("does not store a revision that still offers what does not exist", async () => {
    const { ctx, users } = scriptedCtx([{ message: "Hi {{first_name}}, can I send a quick checklist?" }]);
    const out = await reviseForVoice(ctx, {
      text: "Hi {{first_name}}, want a two sentence example you can try this week?",
      kind: "follow_up",
      template: true,
      assets: [],
    });
    expect(out).toBeNull();
    expect(users[0]).toMatch(/Nothing exists to send/);
  });

  it("revises a pasted title-case label into a plain ask", async () => {
    const { ctx } = scriptedCtx([{ message: CLEAN_ASK }]);
    const out = await reviseForVoice(ctx, {
      text: `If yes, ${LABEL} and pick a time: {{cta_link}}`,
      kind: "follow_up",
      template: true,
      assets: [LABEL],
      ctaLabel: LABEL,
    });
    expect(out).toBe(CLEAN_ASK);
  });
});
