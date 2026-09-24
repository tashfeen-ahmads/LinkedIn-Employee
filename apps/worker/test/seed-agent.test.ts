import { describe, expect, it } from "vitest";
import { HOOK_MAX_CHARS, PITCH_MAX_CHARS } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { seedMissingAgents, seedWorkspaceAgent } from "../src/jobs/seed-agent.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const BUSINESS = {
  companyName: "Referral Nova",
  oneLiner: "We turn a chapter's referrals into tracked introductions.",
  offering: "A platform for chapters and chambers.",
  pricingModel: "monthly",
  proofPoints: ["Four warm intros in week one"],
  toneOfVoice: "Plain, direct, no marketing language.",
  competitors: [],
  commonObjections: ["We already have a spreadsheet"],
  differentiators: ["Introductions that get followed up"],
};

describe("the agent a workspace gets from onboarding", () => {
  it("is built from what onboarding already learned", async () => {
    /*
     * A rep who has just told this product what their company does, who they
     * sell to and how they sound should not then be handed an empty form and
     * asked to say it again. The first version shipped a "New agent" button
     * that produced a blank row, so the screen existed, the data existed, and
     * the two were never introduced.
     */
    const db = new FakeDb();

    const id = await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: BUSINESS,
      repName: "Tashfeen",
    });

    expect(id).toBeTruthy();
    const agent = db.rows("agents")[0]!;
    expect(agent.name).toBe("Referral Nova");
    expect(agent.from_name).toBe("Tashfeen");
    // The business's own tone, not a generic instruction.
    expect(String(agent.system_prompt)).toContain("Plain, direct");
    expect(agent.is_default).toBe(true);
  });

  it("writes one opener and one offer, not a set to choose between", async () => {
    // Several of each is a comparison nobody asked for before they have sent
    // anything, and a screen of variants reads as homework.
    const db = new FakeDb();

    await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: BUSINESS,
      repName: "Tashfeen",
    });

    expect(db.rows("hooks")).toHaveLength(1);
    expect(db.rows("pitches")).toHaveLength(1);
  });

  it("leaves both unapproved, so the approval screen is not decorative", async () => {
    /*
     * An approval is a statement that a person read those exact words
     * (rule 40). Seeding one approved would save a click and make the review
     * meaningless on the single screen where it matters most — the first thing
     * a stranger ever reads from this workspace.
     */
    const db = new FakeDb();

    await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: BUSINESS,
      repName: "Tashfeen",
    });

    expect(db.rows("hooks")[0]?.approved_at ?? null).toBeNull();
    expect(db.rows("pitches")[0]?.approved_at ?? null).toBeNull();
  });

  it("keeps the opener inside LinkedIn's limit", async () => {
    /*
     * LinkedIn refuses the whole invitation at 200 characters, and the note
     * still has to say something specific about the person — an opener that
     * fills it leaves nothing for them.
     *
     * The differentiator here is fifty characters on purpose. A very long one
     * is rejected before it is ever appended, so it never reaches the length
     * guard at all — a first version of this test used four hundred characters
     * and passed while proving nothing, which a mutation run caught. This is
     * the length that is short enough to be used and long enough to overflow.
     */
    const db = new FakeDb();

    await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: {
        ...BUSINESS,
        differentiators: ["introductions that actually get followed up on time"],
        oneLiner: "b".repeat(400),
      },
      repName: "Tashfeen",
    });

    expect(String(db.rows("hooks")[0]?.body).length).toBeLessThanOrEqual(HOOK_MAX_CHARS);
    // And the offer, which is spoken into a chat window on a phone. Over
    // length it falls back rather than being cut mid-clause, which would reach
    // somebody as a broken message under a real rep's name.
    expect(String(db.rows("pitches")[0]?.body).length).toBeLessThanOrEqual(PITCH_MAX_CHARS);
  });

  it("names the person and their company in the opener", async () => {
    // The line this product was asked for. A stranger recognises a person
    // naming their company faster than they recognise a clever sentence.
    const db = new FakeDb();

    await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: BUSINESS,
      repName: "Tashfeen",
    });

    const body = String(db.rows("hooks")[0]?.body);
    expect(body).toContain("{{first_name}}");
    expect(body).toContain("{{company}}");
    expect(body).toContain("{{rep_name}}");
  });

  it("never adds a second agent to a workspace that has one", async () => {
    // It runs on every strategy run. "Which agent" answered by row order is
    // answered differently on different days.
    const db = new FakeDb();
    db.seed("agents", [
      { id: "existing", workspace_id: WORKSPACE, name: "Already here", archived_at: null, is_default: true },
    ]);

    const id = await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: BUSINESS,
      repName: "Tashfeen",
    });

    expect(id).toBeNull();
    expect(db.rows("agents")).toHaveLength(1);
    expect(db.rows("hooks")).toHaveLength(0);
  });
});

describe("giving an agent to workspaces that onboarded before agents existed", () => {
  /*
   * Seeding at the moment the Strategy Agent writes the business profile
   * covers a workspace onboarding today and nobody else. Every workspace on
   * this deployment onboarded before agents existed, so all of them would open
   * the screen, find it empty, and be handed the blank form this was written
   * to remove.
   */
  const OTHER = "99999999-9999-4999-8999-999999999999";

  it("seeds one for every workspace with a profile and none", async () => {
    const db = new FakeDb();
    db.seed("business_profiles", [
      { id: "bp1", workspace_id: WORKSPACE, spec: BUSINESS, created_by: USER },
      { id: "bp2", workspace_id: OTHER, spec: { ...BUSINESS, companyName: "Virtual Pros" }, created_by: null },
    ]);

    expect(await seedMissingAgents(db.asDb())).toBe(2);
    expect(db.rows("agents").map((a) => a.name).sort()).toEqual(["Referral Nova", "Virtual Pros"]);
  });

  it("skips a workspace that already has one", async () => {
    // It runs at boot and again nightly. Running it twice has to cost two
    // queries, not a second agent.
    const db = new FakeDb();
    db.seed("business_profiles", [
      { id: "bp1", workspace_id: WORKSPACE, spec: BUSINESS, created_by: USER },
    ]);

    expect(await seedMissingAgents(db.asDb())).toBe(1);
    expect(await seedMissingAgents(db.asDb())).toBe(0);
    expect(db.rows("agents")).toHaveLength(1);
  });

  it("leaves a business profile the schema cannot read", async () => {
    // An agent built on half a profile writes to real people from facts
    // nobody checked.
    const db = new FakeDb();
    db.seed("business_profiles", [
      { id: "bp1", workspace_id: WORKSPACE, spec: { companyName: "Half a row" }, created_by: USER },
    ]);

    expect(await seedMissingAgents(db.asDb())).toBe(0);
    expect(db.rows("agents")).toHaveLength(0);
  });
});

describe("the opener a real business actually gets", () => {
  it("is the greeting, with no product claim in it", async () => {
    /*
     * A first version derived a question from the business's own
     * differentiators. For the two real businesses on this deployment it
     * produced "— AI-powered matching that scores pairs on seven factors?":
     * a product claim with a question mark on it, inside a connection request.
     * The invitation may not pitch (rule 40).
     *
     * The specific question belongs to the writer, which is the only thing
     * that has seen this particular prospect.
     */
    const db = new FakeDb();

    await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: {
        ...BUSINESS,
        differentiators: [
          "AI-powered matching that scores pairs on seven factors and surfaces a reason to meet.",
        ],
      },
      repName: "Tashfeen",
    });

    const body = String(db.rows("hooks")[0]?.body);
    expect(body.length).toBeLessThanOrEqual(HOOK_MAX_CHARS);
    expect(body).not.toMatch(/AI-powered|scores pairs|seven factors/i);
    // Ends as a finished sentence, never on a dangling dash.
    expect(body.endsWith("—")).toBe(false);
    expect(body.endsWith(".")).toBe(true);
  });
});

describe("the offer a real business gets", () => {
  /*
   * Both live businesses on this deployment write one-liners well over the
   * limit. The first version answered that with "Referral Nova — ask me what
   * we do and I will tell you in one line", which dodges the question, and the
   * offer is the one piece of copy in this product that actually sells the
   * thing.
   */
  const offerFor = async (oneLiner: string, companyName: string) => {
    const db = new FakeDb();
    await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: { ...BUSINESS, companyName, oneLiner },
      repName: "Tashfeen",
    });
    return String(db.rows("pitches")[0]?.body);
  };

  it("says something true rather than dodging the question", async () => {
    const offer = await offerFor(
      "An AI-powered referral networking platform that matches small businesses, solo professionals and networking groups with complementary partners and delivers warm, trackable introductions.",
      "Referral Nova",
    );

    expect(offer).toBe("An AI-powered referral networking platform that matches small businesses.");
    expect(offer).not.toMatch(/ask me what we do/i);
  });

  it("never leaves a bracket open", async () => {
    // Cutting inside an aside leaves "(RV & auto dealers, med spas, dentists."
    // — a sentence holding a bracket open, which reads as a message that was
    // interrupted.
    const offer = await offerFor(
      "AI-powered revenue systems for local businesses (RV & auto dealers, med spas, dentists, home services) that capture leads, automate follow-up and book appointments without adding headcount.",
      "Virtual Pros",
    );

    expect(offer).toBe("AI-powered revenue systems for local businesses.");
    const opens = (offer.match(/\(/g) ?? []).length;
    const closes = (offer.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("keeps a one-liner that already fits, untouched", async () => {
    const short = "We turn a chapter's referrals into tracked introductions.";
    expect(await offerFor(short, "Referral Nova")).toBe(short);
  });

  it("never cuts a word in half", async () => {
    const offer = await offerFor(
      "Revenue systems for dealerships that capture leads and automate every single follow-up conversation reliably",
      "Virtual Pros",
    );

    expect(offer.length).toBeLessThanOrEqual(PITCH_MAX_CHARS);
    const last = offer.replace(/\.$/, "").split(" ").pop() ?? "";
    expect(
      "Revenue systems for dealerships that capture leads and automate every single follow-up conversation reliably",
    ).toContain(last);
  });
});
