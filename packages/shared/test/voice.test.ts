import { describe, expect, it } from "vitest";
import { tidyVoice, voiceProblems } from "../src/voice";

/*
 * Calibrated on what this deployment actually sent to real prospects in
 * October 2026. The bad ones are the reason this module exists; the good ones
 * are the shape the research says gets answered.
 */
const ALLYSON =
  "We are okd school right now manually answering questions yhe next day. I have recently brought AI ti the owners attention.  When I can convince him it will increase our traffic flow we can start looking at systems";

describe("what was sent and should not have been", () => {
  it("flags the reply that pitched a feature list and a link at somebody who said not yet", () => {
    const sent =
      "Got it — you’re answering leads the next day and you’ve already raised AI with the owner. Our Revenue Capture system handles voice, website chat and SMS, qualifies leads and books appointments to your calendar so you don’t miss after-hours opportunities. If you’d like to show the owner what that looks like, book a 15-minute walkthrough with me: https://calendar.app.google/NMnGx9SLMCGuY979A";
    const problems = voiceProblems(sent, "reply", { theirMessage: ALLYSON });
    expect(problems.join(" ")).toMatch(/characters/);
    expect(problems.join(" ")).toMatch(/dash/);
    expect(problems.join(" ")).toMatch(/opens with "got it"/);
  });

  it("flags a reply with a bracketed feature list", () => {
    const sent =
      "Sounds good — thanks for checking the calendar. Our Revenue Capture system does what your current AI does plus it actually books appointments and runs follow-up (voice/chat/SMS qualification, booking, confirmations/reminders and CRM workflows).";
    expect(voiceProblems(sent, "reply").join(" ")).toMatch(/lists several features/);
  });

  it("flags a first message that introduces the product", () => {
    const sent =
      "Thanks for connecting, Cory. I’m introducing Virtual Pros’ Revenue Capture System for RV dealers: AI inquiry handling, follow-up and appointment booking. How does your dealership handle inquiries after closing?";
    expect(voiceProblems(sent, "first_message").join(" ")).toMatch(/i'm introducing|characters|features/i);
  });

  it("flags a note that quotes a job title back in quotation marks", () => {
    const sent =
      'Amy, you’re "Practice Manager at Lucent Aesthetic" in Alamo. I connect with practice managers about easing front-desk work. Mind if we connect?';
    expect(voiceProblems(sent, "invite_note").join(" ")).toMatch(/quotation marks/);
  });

  it("flags a step that relies on a field some people do not have", () => {
    const step = "Hi {{first_name}}, how does {{company}} handle DMs overnight?";
    expect(voiceProblems(step, "first_message").join(" ")).toMatch(/\{\{company\}\}/);
    expect(voiceProblems("Hi {{first_name}}, how do you handle DMs overnight?", "first_message")).toEqual([]);
  });

  it("flags a sign-off and a placeholder in a reply", () => {
    expect(voiceProblems("Happy to send it over. - Tashfeen", "follow_up").join(" ")).toMatch(/sign-off/);
    expect(voiceProblems("Hi {{first_name}}, makes sense.", "reply").join(" ")).toMatch(/placeholder/);
  });
});

describe("what a person would send", () => {
  it("passes short, plain messages", () => {
    const good = [
      ["makes sense. what do you think the owner will push back on most, the cost or the change?", "reply"],
      ["no worries, appreciate you saying so. good luck with the season.", "reply"],
      ["Thanks for connecting, Keon. How are inquiries passed from your marketing channels to the team that follows up?", "first_message"],
      ["Hi Sefina, which part of handling inbound inquiries takes the most time for your team?", "first_message"],
      ["Worth a look? {{cta_link}}", "follow_up"],
    ] as const;
    for (const [text, kind] of good) expect(voiceProblems(text, kind), text).toEqual([]);
  });

  it("does not count a link towards the length", () => {
    const text = `great. grab any time that suits here: https://calendar.app.google/${"x".repeat(60)}`;
    expect(voiceProblems(text, "reply")).toEqual([]);
  });

  it("does not call a reply a mirror for sharing a common word or two", () => {
    expect(voiceProblems("is the owner more worried about cost or about the change?", "reply", { theirMessage: ALLYSON })).toEqual([]);
  });
});

describe("feature runs and templates", () => {
  it("catches three capabilities in a row inside a sentence", () => {
    expect(
      voiceProblems("Our system handles voice, website chat and SMS so nothing slips.", "reply").join(" "),
    ).toMatch(/lists several features/);
  });

  it("does not take a greeting and a name for a list", () => {
    expect(voiceProblems("Sure, Tom and I can talk Tuesday.", "reply")).toEqual([]);
  });

  it("lets a campaign template carry {{first_name}} and a personal note carry none", () => {
    const note = "Hi {{first_name}}, I work with a few plumbing owners nearby. Would be good to connect.";
    expect(voiceProblems(note, "invite_note", { template: true })).toEqual([]);
    expect(voiceProblems(note, "invite_note").join(" ")).toMatch(/placeholder/);
    expect(voiceProblems("Hi {{first_name}}, how does {{company}} do it?", "invite_note", { template: true }).join(" ")).toMatch(
      /\{\{company\}\}/,
    );
  });
});

describe("tidyVoice", () => {
  it("turns dashes into commas and drops a sign-off, and never shortens a sentence", () => {
    expect(tidyVoice("email a one-page gap note—no call. Want that?")).toBe("email a one-page gap note, no call. Want that?");
    expect(tidyVoice("Happy to send it over. — Tashfeen Ahmad")).toBe("Happy to send it over.");
    expect(tidyVoice("keep the one-page note")).toBe("keep the one-page note");
  });
});
