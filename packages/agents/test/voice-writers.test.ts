import { describe, expect, it } from "vitest";
import { draftReply } from "../src/reply.js";
import { buildCampaign, personalizeInvites } from "../src/targeting.js";
import { reviseForVoice } from "../src/revise.js";
import { writeFirstMessage } from "../src/first-message.js";
import type { AgentContext } from "../src/client.js";
import type {
  BusinessProfile,
  CampaignPlan,
  CustomerProfile,
  ReplyClassification,
  RulesOfEngagement,
} from "@le/shared";

/*
 * Every writer checks its own output in code and rewrites once, told exactly
 * what was wrong (`voiceProblems`). These prove the check runs on the real
 * call path rather than only in the helper's own tests: a draft with a dash
 * and a feature list is sent back, and what comes back clean is what is kept.
 */

/** A context that answers each call with the next parse in the list. */
function scriptedCtx(parses: unknown[]) {
  const users: string[] = [];
  const ctx = {
    workspaceId: "w",
    client: {
      models: { writer: "w", classifier: "c" },
      complete: async (request: { user: string }) => {
        users.push(request.user);
        const parsed = parses[Math.min(users.length - 1, parses.length - 1)];
        return { usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, refusal: null, incomplete: null, parsed };
      },
    },
    recordCall: async () => {},
  } as unknown as AgentContext;
  return { ctx, users };
}

const business: BusinessProfile = {
  companyName: "Acme",
  oneLiner: "We answer missed calls for home service companies.",
  offering: "An answering service.",
  differentiators: [],
  proofPoints: [],
  competitors: [],
  pricingModel: "unknown",
  toneOfVoice: "plain",
  commonObjections: [],
};

const classification: ReplyClassification = {
  intent: "not_now",
  sentiment: "neutral",
  confidence: 0.9,
  optOut: false,
  needsHuman: false,
  needsHumanReason: null,
  mentionsPricing: false,
  mentionsLegalOrCompliance: false,
  asksForHuman: false,
  referralName: null,
  followUpAfterDays: null,
};

const rules: RulesOfEngagement = {
  mode: "autopilot",
  goal: "book a meeting",
  handOffOnPricing: true,
  handOffOnLegal: true,
  handOffOnHumanRequest: true,
  handOffOnNegative: true,
  minConfidence: 0.75,
  workingHours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
  bookingLink: undefined,
};

// What a live prospect actually received, near enough: mirrored, dashed, a
// feature list.
const ROBOTIC =
  "Got it — you're answering leads the next day. Our system handles voice, website chat and SMS so nothing slips.";
const HUMAN = "Makes sense. What would the owner need to see before it's worth a look?";

const reply = (message: string) => ({ message, proposesMeeting: false, proposedSlots: [], usedKnowledge: [], unansweredQuestions: [] });

describe("the reply writer rewrites a draft that reads like a model", () => {
  it("sends the problems back and keeps the clean rewrite", async () => {
    const { ctx, users } = scriptedCtx([reply(ROBOTIC), reply(HUMAN)]);
    const out = await draftReply(ctx, {
      business,
      repName: "Rep",
      knowledge: [],
      history: [],
      message: "We're old school, when I convince the owner we can look at systems",
      classification,
      rules,
      availableSlots: [],
    });
    expect(users).toHaveLength(2);
    // The dash is tidied in code; what goes back is what tidying cannot fix.
    expect(users[1]).toMatch(/got it/);
    expect(users[1]).toMatch(/features/);
    expect(out.message).toBe(HUMAN);
    expect(out.voiceProblems).toEqual([]);
  });

  it("does not spend a rewrite on a draft that is already fine", async () => {
    const { ctx, users } = scriptedCtx([reply(HUMAN)]);
    const out = await draftReply(ctx, {
      business,
      repName: "Rep",
      knowledge: [],
      history: [],
      message: "Not right now",
      classification,
      rules,
      availableSlots: [],
    });
    expect(users).toHaveLength(1);
    expect(out.voiceProblems).toEqual([]);
  });

  it("reports what is still wrong when the rewrite fails too", async () => {
    const { ctx } = scriptedCtx([reply(ROBOTIC), reply(ROBOTIC)]);
    const out = await draftReply(ctx, {
      business,
      repName: "Rep",
      knowledge: [],
      history: [],
      message: "We're old school",
      classification,
      rules,
      availableSlots: [],
    });
    expect(out.voiceProblems.length).toBeGreaterThan(0);
  });
});

const profile = {
  name: "Home service owners",
  summary: "Owners of plumbing and HVAC companies.",
  jobTitles: ["Owner"],
  seniority: ["Owner"],
  industries: ["Construction"],
  companySize: "1-10",
  geography: ["United States"],
  triggerEvents: [],
  pains: ["Missed calls."],
  valueProposition: "Every call answered.",
  whatTheyBuy: "An answering service.",
  insteadOfToday: "Voicemail.",
  salesNavFilters: {
    titles: ["Owner"],
    seniorities: ["Owner"],
    industries: ["Construction"],
    companyHeadcount: ["1-10"],
    geographies: ["United States"],
    keywords: [],
    excludeTitles: [],
  },
  hooks: ["a", "b", "c"],
  connectionNote: "note",
  followUps: [{ delayDays: 2, message: "one" }],
  priority: 1,
} as unknown as CustomerProfile;

function plan(firstStep: string): CampaignPlan {
  const steps = [
    { kind: "follow_up" as const, delayDays: 1, message: firstStep },
    { kind: "follow_up" as const, delayDays: 3, message: "Worth a look at how many calls go to voicemail after five?" },
  ];
  return {
    name: "Missed calls",
    connectionNote: "Hi {{first_name}}, I work with a few plumbing owners nearby. Would be good to connect.",
    variants: [
      { name: "A", angle: "a", painPoint: null, connectionNote: "Hi, would be good to connect.", steps: steps.map(({ delayDays, message }) => ({ delayDays, message })) },
      { name: "B", angle: "b", painPoint: null, connectionNote: "Hi, would be good to connect.", steps: steps.map(({ delayDays, message }) => ({ delayDays, message })) },
    ],
    steps,
    stopConditions: [],
    dailyInviteCap: 10,
  };
}

describe("the campaign writer rewrites a sequence that reads like a model", () => {
  const input = { business, profile, repName: "Rep", dailyInviteCap: 10, cta: { kind: "meeting" as const, label: null, url: null } };

  it("sends an unfilled placeholder back to be rewritten", async () => {
    // A raw {{company}} reached a live prospect: nothing fills it in.
    const { ctx, users } = scriptedCtx([
      plan("Hi {{first_name}}, how does {{company}} handle calls after hours?"),
      plan("Hi {{first_name}}, thanks for connecting. How do you handle calls after hours?"),
    ]);
    const out = await buildCampaign(ctx, input);
    expect(users).toHaveLength(2);
    expect(users[1]).toMatch(/\{\{company\}\}/);
    expect(out.steps[0]!.message).not.toContain("{{company}}");
    expect(out.voiceProblems).toEqual([]);
  });

  it("returns the remaining problems rather than hiding them", async () => {
    const bad = plan("Hi {{first_name}}, I'm introducing our system — it handles voice, chat and SMS.");
    const { ctx } = scriptedCtx([bad, bad]);
    const out = await buildCampaign(ctx, input);
    expect(out.voiceProblems.some((p) => p.startsWith("Follow-up 1"))).toBe(true);
    // Tidied regardless: the dash is gone from what is stored.
    expect(out.steps[0]!.message).not.toMatch(/[—–]/);
  });
});

describe("invite notes that read like a template", () => {
  const prospect = {
    providerId: "p1",
    firstName: "Amy",
    lastName: "Lee",
    headline: "Owner at Lee Plumbing",
    title: "Owner",
    company: "Lee Plumbing",
  };
  const input = {
    business,
    profile,
    repName: "Rep",
    campaignAngle: "missed calls",
    prospects: [prospect] as never,
  };
  const note = (text: string) => ({ notes: [{ providerId: "p1", note: text, grounding: ["Owner at Lee Plumbing"], tooThin: false }] });

  it("gets one rewrite and keeps it when it comes back clean", async () => {
    const { ctx, users } = scriptedCtx([
      note('Hi Amy, saw you\'re "Owner at Lee Plumbing" and wanted to connect.'),
      note("Hi Amy, I talk to a lot of plumbing owners about after-hours calls. Would be good to connect."),
    ]);
    const out = await personalizeInvites(ctx, input);
    expect(users).toHaveLength(2);
    expect(out.get("p1")?.note).toMatch(/after-hours calls/);
  });

  it("is left out when the rewrite fails too, so the reviewed fallback is sent", async () => {
    const bad = note('Hi Amy, saw you\'re "Owner at Lee Plumbing" and wanted to connect.');
    const { ctx } = scriptedCtx([bad, bad]);
    const out = await personalizeInvites(ctx, input);
    expect(out.has("p1")).toBe(false);
  });
});

describe("reviseForVoice", () => {
  const msg = (message: string) => ({ message });

  it("returns a clean rewrite of stored copy", async () => {
    const { ctx } = scriptedCtx([msg("Hi {{first_name}}, thanks for connecting. How do you handle calls after hours?")]);
    const out = await reviseForVoice(ctx, {
      text: "Hi {{first_name}}, I'm reaching out about how {{company}} handles calls after hours.",
      kind: "first_message",
      template: true,
    });
    expect(out).toBe("Hi {{first_name}}, thanks for connecting. How do you handle calls after hours?");
  });

  it("never drops the link placeholder or adds a link", async () => {
    const { ctx } = scriptedCtx([msg("Worth a look at acme.com/demo?")]);
    const out = await reviseForVoice(ctx, {
      text: "I'm reaching out to share this: {{cta_link}}",
      kind: "follow_up",
      template: true,
    });
    expect(out).toBeNull();
  });

  it("spends nothing on copy that already passes", async () => {
    const { ctx, users } = scriptedCtx([msg("x")]);
    const out = await reviseForVoice(ctx, { text: "How do you handle calls after hours?", kind: "follow_up", template: true });
    expect(out).toBe("How do you handle calls after hours?");
    expect(users).toHaveLength(0);
  });
});

describe("writeFirstMessage", () => {
  const input = {
    business: { companyName: "Glovecars", toneOfVoice: "plain" },
    repName: "Igor",
    angle: "after-hours leads",
    inviteNote: "Hi Jane, I talk to a lot of RV dealers.",
    prospect: { firstName: "Jane", company: "Lee RV", title: "GM" },
  };
  const msg = (message: string) => ({ message });

  it("keeps a short, personal message", async () => {
    const { ctx, users } = scriptedCtx([msg("Hi Jane, thanks for connecting. Are most leads at Lee RV coming in after hours?")]);
    expect(await writeFirstMessage(ctx, input)).toMatch(/Lee RV/);
    expect(users).toHaveLength(1);
  });

  it("sends back a message that names the company or pitches, and gives up rather than send it", async () => {
    const pitch = msg("Hi Jane, Glovecars answers your leads 24/7. Want a demo?");
    const { ctx, users } = scriptedCtx([pitch, pitch]);
    expect(await writeFirstMessage(ctx, input)).toBeNull();
    expect(users[1]).toMatch(/names the company/);
  });
});
