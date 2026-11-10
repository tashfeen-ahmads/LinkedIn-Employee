import { describe, expect, it } from "vitest";
import { effectiveIntent, replyMove } from "../src/reply-playbook.js";

describe("replyMove", () => {
  it("lets somebody interested hear the offer and get the next step", () => {
    const move = replyMove("interested", "sounds good, tell me more");
    expect(move).toMatchObject({ reply: true, pitch: true, link: true, slots: true });
  });

  it("gives somebody not ready no pitch, no link and no times", () => {
    const move = replyMove("not_now", "when I can convince the owner we can start looking at systems");
    expect(move).toMatchObject({ reply: true, pitch: false, link: false, slots: false });
  });

  it("answers a question without a link unless they asked for one", () => {
    expect(replyMove("question", "does it work with Jobber?").link).toBe(false);
    expect(replyMove("question", "can you send me the link?").link).toBe(true);
  });

  it("does not send the link again to somebody who already has it", () => {
    const move = replyMove("interested", "I'll check your calendar and get back to you", { linkAlreadySent: true });
    expect(move).toMatchObject({ pitch: false, link: false, slots: false });
    // Unless they say they lost it.
    expect(replyMove("interested", "can you resend the link?", { linkAlreadySent: true }).link).toBe(true);
  });

  it("does not answer an auto-reply or spam", () => {
    expect(replyMove("out_of_office", "away until Monday").reply).toBe(false);
    expect(replyMove("spam", "buy followers").reply).toBe(false);
  });

  it("never pitches into an objection", () => {
    expect(replyMove("objection", "too expensive for us")).toMatchObject({ pitch: false, link: false });
  });
});

describe("effectiveIntent: the words win over a warm misreading", () => {
  // Both are real replies this deployment received and misread.
  it("reads a not-yet as not_now even when the classifier said interested", () => {
    const allyson =
      "We are okd school right now manually answering questions yhe next day. I have recently brought AI ti the owners attention.  When I can convince him it will increase our traffic flow we can start looking at systems";
    expect(effectiveIntent("interested", allyson)).toBe("not_now");
    expect(replyMove("interested", allyson)).toMatchObject({ pitch: false, link: false, slots: false });
  });

  it("reads 'we already have one' as an objection, not a pleasantry", () => {
    const paul = "Hi Igor, I appreciate the connection. We currently have an AI program that answers our after hours inquiries.";
    expect(effectiveIntent("other", paul)).toBe("objection");
  });

  it("leaves a real yes alone", () => {
    expect(effectiveIntent("interested", "Sure, send me the link")).toBe("interested");
    expect(effectiveIntent("interested", "Sounds good, what times work this week?")).toBe("interested");
  });

  it("never turns a no into something softer", () => {
    expect(effectiveIntent("not_interested", "not right now, and please don't follow up")).toBe("not_interested");
  });
});

describe("a short answer means what our question meant", () => {
  // Muhammad, on a live campaign: "No we are working on odoo", then "Yes" to
  // "Is Odoo already hosting your onboarding docs?" The classifier read the
  // Yes as interested at 0.9 and the reply pitched the solved problem with a
  // booking link.
  const ourQuestion = "Good to know. Is Odoo already hosting your onboarding docs for the franchise and acquisition deals?";

  it("is never a yes to buying when our question did not offer a next step", () => {
    expect(effectiveIntent("interested", "Yes", { lastRepMessage: ourQuestion })).toBe("other");
    expect(replyMove("interested", "Yes", { lastRepMessage: ourQuestion })).toMatchObject({ pitch: false, link: false, slots: false });
  });

  it("is an objection when the read says the problem is already handled", () => {
    const move = replyMove("interested", "Yes", { lastRepMessage: ourQuestion, alreadySolved: true });
    expect(move).toMatchObject({ pitch: false, link: false, slots: false });
    expect(move.guidance).toMatch(/already handled/);
  });

  it("is a yes when our question was the offer of a next step", () => {
    expect(effectiveIntent("interested", "Yes", { lastRepMessage: "Want me to send the link over?" })).toBe("interested");
  });

  it("reads naming the system they are on as already covered", () => {
    expect(effectiveIntent("other", "No we are working on odoo")).toBe("objection");
  });

  it("keeps a problem solved earlier in the conversation solved, until they ask for the next step", () => {
    expect(effectiveIntent("interested", "Sounds good", { alreadySolved: true })).toBe("objection");
    expect(effectiveIntent("interested", "Ok send me the link", { alreadySolved: true })).toBe("interested");
  });
});
