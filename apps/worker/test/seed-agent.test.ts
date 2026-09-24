import { describe, expect, it } from "vitest";
import { HOOK_MAX_CHARS, PITCH_MAX_CHARS } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { seedWorkspaceAgent } from "../src/jobs/seed-agent.js";

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

  it("uses the short clause when it does fit", async () => {
    // Otherwise the guard above could be satisfied by never appending
    // anything, and the opener would be the bare template for everybody.
    const db = new FakeDb();

    await seedWorkspaceAgent(db.asDb(), {
      workspaceId: WORKSPACE,
      userId: USER,
      business: { ...BUSINESS, differentiators: ["referral tracking"] },
      repName: "Tashfeen",
    });

    expect(String(db.rows("hooks")[0]?.body)).toContain("referral tracking");
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
