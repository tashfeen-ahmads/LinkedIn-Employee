import { describe, expect, it } from "vitest";
import { replyMove } from "../src/reply-playbook.js";

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
