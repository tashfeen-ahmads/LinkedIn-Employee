import { describe, expect, it } from "vitest";
import {
  offeredAsset,
  openerProblems,
  sharedWordRun,
  titleCaseCta,
  voiceProblems,
} from "../src/voice";
import { campaignNameWithoutCta } from "../src/cta";

/*
 * Calibrated on a live workspace (Freelancer, October 2026): five approved
 * strategies, one approved opener written for founders, and campaign copy that
 * promised artefacts nobody had and pasted its CTA label like a button.
 */

const FOUNDERS_OPENER =
  "Quick yes or no: do founders still run outbound at your company, or do you have an SDR team?";

describe("an offer of something that does not exist", () => {
  it("flags the example and the checklist that went out with nothing behind them", () => {
    const example = "Hi {{first_name}}, want a two sentence example you can try this week?";
    const checklist = "Can I send a quick checklist for keeping reps on outbound?";
    expect(voiceProblems(example, "follow_up", { template: true }).join(" ")).toMatch(/offers an example that does not exist/);
    expect(voiceProblems(checklist, "follow_up", { template: true }).join(" ")).toMatch(/checklist/);
    expect(offeredAsset("Would a quick checklist help?")).toBe("checklist");
    expect(offeredAsset("Want me to send over a guide on this?")).toBe("guide");
    expect(offeredAsset("Interested in a free audit? {{cta_link}}")).toBe("audit");
  });

  it("allows the offer when the asset exists in the knowledge base or the CTA", () => {
    expect(offeredAsset("Want the free audit? {{cta_link}}", ["Free Website Audit"])).toBeNull();
    expect(offeredAsset("Can I send our onboarding checklist?", ["Onboarding Checklist"])).toBeNull();
    // An address names its asset in its path, never its host.
    expect(offeredAsset("Want a two sentence example?", ["https://cal.example.com/consult"])).toBe("example");
    expect(offeredAsset("Want the checklist? {{cta_link}}", ["https://acme.test/checklist"])).toBeNull();
    expect(
      voiceProblems("Want a two sentence example? {{cta_link}}", "follow_up", {
        template: true,
        assets: ["Outbound opener examples"],
      }),
    ).toEqual([]);
  });

  it("does not read asking for their own document as an offer", () => {
    expect(offeredAsset("Could you share the playbook your reps use?")).toBeNull();
    expect(offeredAsset("Do you send a checklist to new hires?")).toBeNull();
    // "you" is not the subject here, so it is still our offer.
    expect(offeredAsset("Can I send you a checklist?")).toBe("checklist");
    expect(offeredAsset("Do you want a checklist?")).toBe("checklist");
  });

  it("does not read an ordinary sentence as an offer", () => {
    expect(offeredAsset("For example, most teams answer the next day.")).toBeNull();
    expect(offeredAsset("Happy to grab 20 minutes? {{cta_link}}")).toBeNull();
    expect(offeredAsset("Are you still hiring for ops this quarter?")).toBeNull();
  });

  it("checks a reply only when its writer says what exists", () => {
    const text = "Want me to send a quick checklist?";
    expect(voiceProblems(text, "reply").join(" ")).not.toMatch(/does not exist/);
    expect(voiceProblems(text, "reply", { assets: [] }).join(" ")).toMatch(/does not exist/);
  });
});

describe("a CTA label pasted like a button", () => {
  const sent = "If yes, Book a Free Consultation and pick a time: {{cta_link}}";

  it("flags the label mid-sentence in title case, with or without the label known", () => {
    expect(titleCaseCta(sent)).toBe("Book a Free Consultation");
    expect(titleCaseCta(sent, "Book a Free Consultation")).toBe("Book a Free Consultation");
    expect(voiceProblems(sent, "follow_up", { template: true }).join(" ")).toMatch(/title case/);
  });

  it("flags the known label even at the start of a sentence", () => {
    expect(titleCaseCta("Free Website Audit here: {{cta_link}}", "Free Website Audit")).toBe("Free Website Audit");
  });

  it("leaves a plain ask, and a label that is not title case, alone", () => {
    expect(titleCaseCta("Happy to grab 20 minutes? {{cta_link}}", "Book a Free Consultation")).toBeNull();
    expect(titleCaseCta("Worth a quick chat? Book a meeting here: {{cta_link}}", "Book a meeting")).toBeNull();
    expect(titleCaseCta("Sure, Tom and I can talk Friday.")).toBeNull();
  });
});

describe("a note built on an opener", () => {
  const maria = "Quick yes or no Maria: do founders still run outbound where you hire";

  it("flags a note that borrows an opener written for a different audience", () => {
    expect(sharedWordRun(maria, FOUNDERS_OPENER)).toBe(5);
    expect(openerProblems(maria, { foreign: [FOUNDERS_OPENER] }).join(" ")).toMatch(/different audience/);
    expect(voiceProblems(maria, "invite_note", { openers: { foreign: [FOUNDERS_OPENER] } }).join(" ")).toMatch(
      /different audience/,
    );
  });

  it("lets a note lean on its own strategy's opener, but never paste it", () => {
    expect(openerProblems(maria, { own: [FOUNDERS_OPENER] })).toEqual([]);
    expect(openerProblems(`Hi Sam. ${FOUNDERS_OPENER}`, { own: [FOUNDERS_OPENER] }).join(" ")).toMatch(/word for word/);
    // Listed as both: it is this note's own, so only the paste rule applies.
    expect(openerProblems(maria, { own: [FOUNDERS_OPENER], foreign: [FOUNDERS_OPENER] })).toEqual([]);
  });

  it("passes a note written from the person's own details", () => {
    const note = "Hi Maria, you place ops people across Texas. Are you filling more roles than last year?";
    expect(openerProblems(note, { foreign: [FOUNDERS_OPENER] })).toEqual([]);
  });
});

describe("campaign names", () => {
  it("drops the call to action from the name", () => {
    expect(campaignNameWithoutCta("Staffing agency owners (Book a Free Consultation)", "Book a Free Consultation")).toBe(
      "Staffing agency owners",
    );
    expect(campaignNameWithoutCta("Founders - Book a Free Consultation", "Book a Free Consultation")).toBe("Founders");
    expect(campaignNameWithoutCta("Brokers (Book a Call)", null)).toBe("Brokers");
  });

  it("keeps a name that is nothing but the label, and one that never had it", () => {
    expect(campaignNameWithoutCta("Book a Free Consultation", "Book a Free Consultation")).toBe("Book a Free Consultation");
    expect(campaignNameWithoutCta("Revenue ops leaders", "Book a Free Consultation")).toBe("Revenue ops leaders");
  });
});

describe("a company name is not a pasted button", () => {
  // Copy written for one person names their company; "Get Set Fitness" reads
  // to the broad title-case pattern exactly like a pasted call to action.
  it("leaves a first message naming the prospect's company alone", () => {
    const problems = voiceProblems("Saw Get Set Fitness opened a second site. How is the new one going?", "first_message");
    expect(problems.join(" ")).not.toMatch(/title case/);
  });

  it("still flags a pasted button in a campaign's template", () => {
    const problems = voiceProblems("If yes, Book a Strategy Call here: {{cta_link}}", "follow_up", { template: true });
    expect(problems.join(" ")).toMatch(/title case/);
  });

  it("still flags the campaign's own label in copy for one person", () => {
    const problems = voiceProblems("Happy to set up a Free Growth Audit for you.", "reply", { ctaLabel: "Free Growth Audit" });
    expect(problems.join(" ")).toMatch(/title case/);
  });
});
