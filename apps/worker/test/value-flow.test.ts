import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { detectAcceptedInvitations } from "../src/jobs/acceptance.js";
import { handleInboundMessage } from "../src/jobs/inbound.js";
import { planEngagement } from "../src/jobs/engagement.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { repairCopy } from "../src/jobs/repair-copy.js";
import {
  DEFAULT_ANSWERS,
  HOUR,
  MINUTE,
  SEEDED_OPENER,
  SEEDED_PITCH,
  STRATEGIES,
  WORKSPACE,
  approveStep,
  businessStep,
  ctaStep,
  drain,
  dueAt,
  runSage,
  hoursStep,
  launchStep,
  linkedinStep,
  localTime,
  people,
  post,
  runWorker,
  setNow,
  strategyId,
  voiceStep,
  world,
  type Answers,
  type World,
} from "./value-flow-harness.js";

/*
 * Every answer a customer gives in onboarding, followed to the place it is
 * used — through the worker's real job functions, in the order a customer
 * meets them, against one in-memory database.
 *
 * The unit tests beside this file each prove one function right. This file
 * proves the functions are handed the right things: that the call to action
 * picked on step five is the link in the message a stranger reads on day six,
 * that the hours typed on step three are the hours an invitation is placed in,
 * and that the bio typed on step four is in the prompt that writes to them.
 *
 * Written to describe correct behaviour. Some of these fail today; each
 * failure is a value dropped between two stages that are each, on their own,
 * correct.
 */

const TZ = DEFAULT_ANSWERS.timezone;
const BIO = DEFAULT_ANSWERS.voice.bio;
const NAME = DEFAULT_ANSWERS.voice.fullName;

interface Flow {
  w: World;
  a: Answers;
  accountId: string;
  ctaId: string;
  profileId: string;
  campaignId: string;
}

/** Onboarding, step by step, up to the list being built (everything before Launch). */
async function onboard(
  answers: Partial<Answers>,
  prefix = "agency",
  options: { sageLate?: boolean; stubbornWriter?: boolean } = {},
): Promise<Flow> {
  const a: Answers = { ...DEFAULT_ANSWERS, ...answers };
  const w = world();
  w.llm.stubbornCtaLabel = Boolean(options.stubbornWriter);
  // The business step queues Sage; with `sageLate` its run lands after the
  // person has answered the next four steps, as a slow model run does.
  await businessStep(w, a, { runSage: !options.sageLate });
  const accountId = linkedinStep(w, a);
  hoursStep(w, a, accountId);
  voiceStep(w, a);
  const ctaId = ctaStep(w, a);
  if (options.sageLate) await runSage(w, a);
  const profileId = strategyId(w, STRATEGIES[0]!.name);
  const campaignId = await approveStep(w, profileId, accountId, people(prefix, "Brightside Agency"));
  if (!campaignId) {
    const why = w.db.rows("events").filter((e) => e.name === "targeting.stopped").map((e) => JSON.stringify(e.payload));
    throw new Error(`the search built no campaign: ${why.join("; ")}`);
  }
  return { w, a, accountId, ctaId, profileId, campaignId };
}

function invitedProviderIds(w: World): string[] {
  return w.linkedin.sentInvitations.map((i) => i.providerId);
}

/** What one prospect has been sent, in order. */
function sentTo(w: World, providerId: string): string[] {
  return w.linkedin.sentMessages
    .filter((m) => m.providerId === providerId || m.chatId === `chat_${providerId}`)
    .map((m) => m.text);
}

/** The hourly acceptance poll, finding that this person accepted. */
async function accept(w: World, providerId: string): Promise<void> {
  setNow(Date.now() + 30 * MINUTE);
  w.linkedin.relations = [...w.linkedin.relations, { providerId, connectedAt: new Date().toISOString() }];
  await detectAcceptedInvitations(w.ctx, new Date());
}

/** Runs the worker until this person has been sent `n` messages. */
async function untilSent(f: Flow, providerId: string, n: number): Promise<void> {
  if (!(await runWorker(f.w, () => sentTo(f.w, providerId).length >= n, 4 * 24 * 60))) {
    const prospect = f.w.db.rows("prospects").find((p) => p.provider_id === providerId);
    const cp = f.w.db.rows("campaign_prospects").find((row) => row.prospect_id === prospect?.id);
    throw new Error(`message ${n} to ${providerId} never went out (row: ${JSON.stringify(cp)})`);
  }
}

/** Invitations → the first person accepts → steps 1, 2 and 3 of their sequence, as the worker runs them. */
async function walkSequence(f: Flow): Promise<{ first: string; second: string }> {
  const { w } = f;
  if (!(await runWorker(w, () => w.linkedin.sentInvitations.length >= 2, 3 * 24 * 60))) {
    throw new Error("the invitations did not go out");
  }
  const [first, second] = invitedProviderIds(w) as [string, string];
  await accept(w, first);
  await untilSent(f, first, 1);
  setNow(Date.now() + 2 * 24 * HOUR);
  await untilSent(f, first, 2);
  setNow(Date.now() + 3 * 24 * HOUR);
  await untilSent(f, first, 3);
  return { first, second };
}

/** A prospect's LinkedIn reply arriving through the inbound job. */
async function reply(f: Flow, providerId: string, text: string): Promise<void> {
  const conversation = f.w.db
    .rows("conversations")
    .find((c) => c.prospect_id === f.w.db.rows("prospects").find((p) => p.provider_id === providerId)?.id);
  await handleInboundMessage(f.w.ctx, f.w.queues, {
    workspaceId: WORKSPACE,
    linkedinAccountId: f.accountId,
    providerChatId: String(conversation?.provider_chat_id ?? `chat_${providerId}`),
    providerMessageId: `in_${providerId}_${Date.now()}`,
    fromProviderId: providerId,
    text,
    receivedAt: new Date().toISOString(),
  });
}

function inviteJobs(w: World) {
  return [...w.jobs.values()].filter((job) => job.data.kind === "invite");
}

/* ====================================================================== */

describe("A: a meeting campaign, the rep's own scheduling link, Nora answers", () => {
  let f: Flow;
  let first: string;
  let second: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Tuesday 13 October 2026, 06:00 Pacific: before the 7am sending start the
    // rep chose, and already inside the 8–18 UTC default window.
    setNow("2026-10-13T13:00:00Z");
    f = await onboard({});
  });
  afterAll(() => vi.useRealTimers());

  it("the approved strategy's own openers and pains reach its invite-note prompt", () => {
    const prompt = f.w.llm.last("invite-note")!.system;
    for (const hook of STRATEGIES[0]!.hooks) expect(prompt).toContain(hook);
    expect(prompt).toContain(STRATEGIES[0]!.pains[0]);
  });

  it("approval searches the approved strategy's own filters, on the tier the plan answer gives", () => {
    const search = f.w.linkedin.searches[0]!;
    expect(search.accountId).toBe("acct_sam");
    expect(search.query).toEqual(STRATEGIES[0]!.salesNavFilters);
    // "Premium" on the connect step is not Sales Navigator (rule 12).
    expect(search.tier).toBe("classic");
  });

  it("the voice step's name and bio reach the invite-note writer", () => {
    const prompt = f.w.llm.last("invite-note")!.system;
    expect(prompt).toContain(NAME);
    expect(prompt).toContain(BIO);
    expect(prompt).not.toContain(DEFAULT_ANSWERS.signupFullName);
  });

  it("the voice step's name and bio reach the campaign (follow-up) writer", () => {
    const prompt = f.w.llm.last("campaign")!.system;
    expect(prompt).toContain(NAME);
    expect(prompt).toContain(BIO);
  });

  it("the CTA chosen in onboarding reaches the campaign writer and the campaign row", () => {
    expect(f.w.llm.last("campaign")!.system).toContain("The call to action for this campaign is: Book a meeting.");
    const campaign = f.w.db.find("campaigns", { id: f.campaignId })!;
    expect(campaign.cta_kind).toBe("meeting");
    expect(campaign.cta_id).toBe(f.ctaId);
  });

  it("launching at 06:00 Pacific places no invitation (outside the 7–15 window, inside UTC's default)", async () => {
    const enqueued = await launchStep(f.w, f.a, f.campaignId);
    expect(enqueued).toBe(0);
    expect(inviteJobs(f.w)).toHaveLength(0);
  });

  it("from 07:00 Pacific every invitation is placed and sent inside the rep's sending hours", async () => {
    setNow("2026-10-13T14:05:00Z"); // 07:05 Pacific
    const sent = await runWorker(f.w, () => f.w.linkedin.sentInvitations.length >= 2, 8 * 60);
    expect(sent).toBe(true);
    for (const job of inviteJobs(f.w)) {
      const at = localTime(dueAt(job), TZ);
      expect(DEFAULT_ANSWERS.sending.days).toContain(at.weekday);
      expect(at.hour).toBeGreaterThanOrEqual(DEFAULT_ANSWERS.sending.start);
      expect(at.hour).toBeLessThan(DEFAULT_ANSWERS.sending.end);
    }
    // The personalised note is what LinkedIn received.
    const notes = new Map(f.w.db.rows("campaign_prospects").map((cp) => [cp.prospect_id, cp.invite_note]));
    for (const sentInvite of f.w.linkedin.sentInvitations) {
      const prospect = f.w.db.rows("prospects").find((p) => p.provider_id === sentInvite.providerId)!;
      expect(sentInvite.note).toBe(notes.get(prospect.id));
    }
  });

  it("likes and comments are planned for invited prospects inside hours (engage_posts on), none outside", async () => {
    for (const id of invitedProviderIds(f.w)) f.w.linkedin.posts[id] = [post(id, new Date())];
    // 06:30 Pacific, before the rep's 7am start (and inside UTC's 8–18 default): nothing.
    const early = new Date("2026-10-13T13:30:00Z");
    expect((await planEngagement(f.w.ctx, f.w.queues, early)).planned).toBe(0);
    // Inside hours: a like each, and a comment written in the rep's voice.
    const { planned } = await planEngagement(f.w.ctx, f.w.queues, new Date());
    expect(planned).toBeGreaterThan(0);
    const likes = f.w.db.rows("engagement_actions").filter((r) => r.kind === "reaction");
    expect(likes.length).toBeGreaterThan(0);
    const commentPrompt = f.w.llm.last("comment");
    expect(commentPrompt?.system).toContain(BIO);
  });

  it("the first message after acceptance is written with the voice step's name and bio", async () => {
    ({ first, second } = await walkSequence(f));
    const prompt = f.w.llm.last("first-message")!.system;
    expect(prompt).toContain(NAME);
    expect(prompt).toContain(BIO);
    expect(sentTo(f.w, first)[0]).toMatch(/^Thanks for accepting, Jane\./);
  });

  it("step 2 is the pitch approved at launch, rendered (no {{pitch}})", () => {
    const text = sentTo(f.w, first)[1]!;
    expect(text).toContain(SEEDED_PITCH);
    expect(text).not.toMatch(/\{\{/);
  });

  it("step 3 carries the rep's booking link for {{cta_link}}, never a raw placeholder or the Title-Case label", () => {
    const text = sentTo(f.w, first)[2]!;
    expect(text).toContain(DEFAULT_ANSWERS.cta.bookingUrl);
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(text).not.toContain(DEFAULT_ANSWERS.cta.label!);
  });

  it("every follow-up went out inside the rep's sending hours, in their zone", () => {
    const outbound = f.w.db.rows("messages").filter((m) => m.direction === "outbound");
    expect(outbound.length).toBeGreaterThanOrEqual(3);
    for (const message of outbound) {
      const at = localTime(Date.parse(String(message.sent_at)), TZ);
      expect(DEFAULT_ANSWERS.sending.days).toContain(at.weekday);
      expect(at.hour).toBeGreaterThanOrEqual(DEFAULT_ANSWERS.sending.start);
      expect(at.hour).toBeLessThan(DEFAULT_ANSWERS.sending.end);
    }
  });

  it("an interested reply (before the link went out) is offered the rep's booking link and the approved pitch, and no built-in times", async () => {
    // The second person accepts and replies to their first message, so the
    // link has not been sent to them yet.
    await accept(f.w, second);
    await untilSent(f, second, 1);
    setNow(Date.now() + HOUR);
    await reply(f, second, "Yes, this sounds useful. How would it work for us?");
    const prompt = f.w.llm.last("reply-draft")!;
    expect(prompt.system).toContain(SEEDED_PITCH);
    expect(prompt.user).toContain(`The ONLY link you may send is ${DEFAULT_ANSWERS.cta.bookingUrl}.`);
    expect(prompt.user).not.toContain("Times you may offer");
    const draft = f.w.db.rows("reply_drafts").at(-1)!;
    expect(draft.body).toContain(DEFAULT_ANSWERS.cta.bookingUrl);
    expect(draft.proposed_slots).toEqual([]);
  });

  it("the reply writer is given the voice step's name and bio", () => {
    const prompt = f.w.llm.last("reply-draft")!.system;
    expect(prompt).toContain(`Salesperson: ${NAME}`);
    expect(prompt).toContain(BIO);
  });

  it("'Let Nora run it': the clean reply is approved and sent without a person", async () => {
    const draft = f.w.db.rows("reply_drafts").at(-1)!;
    expect(draft.status).toBe("approved");
    const before = f.w.linkedin.sentMessages.length;
    const job = [...f.w.jobs.values()].find((j) => j.data.kind === "reply");
    expect(job).toBeDefined();
    if (job) await runLinkedInAction(f.w.ctx, job.data);
    expect(f.w.linkedin.sentMessages.length).toBe(before + 1);
    expect(f.w.linkedin.sentMessages.at(-1)!.text).toBe(draft.body);
  });
});

/* ====================================================================== */

describe("B: a sign-up link campaign, 'I'll check each one'", () => {
  const SIGNUP = "https://northbeam.io/start";
  const LABEL = "Start Your Free Trial";
  let f: Flow;
  let first: string;
  let second: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setNow("2026-10-13T14:05:00Z"); // Tuesday 07:05 Pacific
    f = await onboard({ cta: { kind: "link", label: LABEL, url: SIGNUP }, handling: "check" }, "signup");
    await launchStep(f.w, f.a, f.campaignId);
  });
  afterAll(() => vi.useRealTimers());

  it("the campaign writer is told it is a link campaign, with {{cta_link}} and no meeting", () => {
    const prompt = f.w.llm.last("campaign")!.system;
    expect(prompt).toContain("The call to action for this campaign is: Send them a link.");
    expect(prompt).not.toContain("Book a meeting");
    expect(f.w.db.find("campaigns", { id: f.campaignId })!.cta_kind).toBe("link");
  });

  it("step 3 carries the sign-up URL for {{cta_link}}, never a raw placeholder or the Title-Case label", async () => {
    ({ first, second } = await walkSequence(f));
    const text = sentTo(f.w, first)[2]!;
    expect(text).toContain(SIGNUP);
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(text).not.toContain(LABEL);
  });

  it("an interested reply (before the link went out) is offered the sign-up link, never times or a call", async () => {
    await accept(f.w, second);
    await untilSent(f, second, 1);
    setNow(Date.now() + HOUR);
    await reply(f, second, "Yes, this sounds useful. How would it work for us?");
    const prompt = f.w.llm.last("reply-draft")!;
    expect(prompt.system).toContain("This campaign is NOT asking for a meeting");
    expect(prompt.user).toContain(`The ONLY link you may send is ${SIGNUP}.`);
    expect(prompt.user).not.toContain("Times you may offer");
    const draft = f.w.db.rows("reply_drafts").at(-1)!;
    expect(draft.proposes_meeting).toBe(false);
    expect(String(draft.body)).not.toMatch(/\bcall\b|cal\.com|\/book\//i);
    expect(draft.body).toContain(SIGNUP);
  });

  it("'I'll check each one': the clean reply is held for a person, not sent", () => {
    const draft = f.w.db.rows("reply_drafts").at(-1)!;
    expect(draft.status).toBe("pending");
    expect([...f.w.jobs.values()].some((j) => j.data.kind === "reply")).toBe(false);
    expect(sentTo(f.w, second)).toHaveLength(1);
  });
});

/* ====================================================================== */

describe("C: a meeting campaign with no scheduling link of the rep's own", () => {
  let f: Flow;
  let first: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setNow("2026-10-13T14:05:00Z"); // Tuesday 07:05 Pacific
    f = await onboard({ cta: { kind: "meeting", label: null } }, "builtin");
    await launchStep(f.w, f.a, f.campaignId);
  });
  afterAll(() => vi.useRealTimers());

  it("step 3 carries this product's booking page for {{cta_link}}, never a raw placeholder", async () => {
    ({ first } = await walkSequence(f));
    const text = sentTo(f.w, first)[2]!;
    expect(text).toContain("https://app.test/book/");
    expect(text).not.toMatch(/\{\{|\}\}/);
  });

  it("an interested reply is offered times only inside the meeting hours and zone chosen in onboarding", async () => {
    // Monday 19 October, 10:00 Pacific: inside sending hours, outside meeting days.
    setNow("2026-10-19T17:00:00Z");
    await reply(f, first, "Yes, this sounds useful. How would it work for us?");
    const prompt = f.w.llm.last("reply-draft")!;
    expect(prompt.user).toContain("Times you may offer");
    const draft = f.w.db.rows("reply_drafts").at(-1)!;
    const slots = draft.proposed_slots as string[];
    expect(slots.length).toBeGreaterThan(0);
    const { meeting } = DEFAULT_ANSWERS;
    for (const slot of slots) {
      const at = localTime(Date.parse(slot), TZ);
      expect(meeting.days).toContain(at.weekday);
      expect(at.hour).toBeGreaterThanOrEqual(meeting.start);
      expect(at.hour * 60 + at.minute + meeting.minutes).toBeLessThanOrEqual(meeting.end * 60);
    }
  });

  it("accepting an offered time books it on the rep's calendar, at that time, for the meeting length chosen", async () => {
    const offered = f.w.db.rows("reply_drafts").at(-1)!;
    const job = [...f.w.jobs.values()].find((j) => j.data.kind === "reply");
    expect(job).toBeDefined();
    if (job) await runLinkedInAction(f.w.ctx, job.data);
    setNow(Date.now() + HOUR);
    await reply(f, first, "The first one works for me.");
    const meeting = f.w.db.rows("meetings").at(-1);
    expect(meeting).toBeDefined();
    expect(meeting!.starts_at).toBe((offered.proposed_slots as string[])[0]);
    expect(Date.parse(String(meeting!.ends_at)) - Date.parse(String(meeting!.starts_at))).toBe(
      DEFAULT_ANSWERS.meeting.minutes * MINUTE,
    );
  });
});

/* ====================================================================== */

describe("F: Sage finishes after the voice and CTA steps (it runs while the person carries on)", () => {
  let f: Flow;
  let first: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setNow("2026-10-13T14:05:00Z");
    f = await onboard({}, "late", { sageLate: true });
    await launchStep(f.w, f.a, f.campaignId);
  });
  afterAll(() => vi.useRealTimers());

  it("the agent Sage seeds late still writes as the voice step's name, with its bio", () => {
    const prompt = f.w.llm.last("invite-note")!.system;
    expect(prompt).toContain(NAME);
    expect(prompt).toContain(BIO);
  });

  it("the CTA chosen before any strategy existed reaches the campaign, and step 3 carries the booking link", async () => {
    expect(f.w.db.find("campaigns", { id: f.campaignId })!.cta_id).toBe(f.ctaId);
    ({ first } = await walkSequence(f));
    const text = sentTo(f.w, first)[2]!;
    expect(text).toContain(DEFAULT_ANSWERS.cta.bookingUrl);
    expect(text).not.toMatch(/\{\{|\}\}/);
  });
});

/* ====================================================================== */

describe("D: a second strategy approved after the first launched", () => {
  let f: Flow;
  let second: string | null;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setNow("2026-10-13T14:05:00Z");
    f = await onboard({});
    // Launch approves the agent's seeded opener, which Sage wrote about
    // strategy 1's pain ("agency referrals").
    await launchStep(f.w, f.a, f.campaignId);
    setNow(Date.now() + HOUR);
    second = await approveStep(
      f.w,
      strategyId(f.w, STRATEGIES[1]!.name),
      f.accountId,
      people("accounting", "Ledgerline CPAs"),
    );
  });
  afterAll(() => vi.useRealTimers());

  it("builds the second strategy's campaign on the CTA chosen in onboarding", () => {
    expect(second).toBeTruthy();
    expect(f.w.db.find("campaigns", { id: second! })!.cta_id).toBe(f.ctaId);
  });

  it("the second strategy's own pains reach its invite-note prompt", () => {
    expect(f.w.llm.last("invite-note")!.system).toContain(STRATEGIES[1]!.pains[0]);
  });

  it("the second strategy's own openers reach its invite-note prompt", () => {
    const prompt = f.w.llm.last("invite-note")!.system;
    for (const hook of STRATEGIES[1]!.hooks) expect(prompt).toContain(hook);
  });

  it("an opener approved for the first strategy is not forced onto the second", () => {
    // It may be offered as an optional shape for other audiences; it must not
    // be one of the angles this strategy's notes are written in.
    const system = f.w.llm.last("invite-note")!.system;
    const context = JSON.parse(system.slice(system.indexOf("Who is sending, and why:\n") + 25)) as {
      openingAngles?: string[];
    };
    expect(context.openingAngles ?? []).not.toContain(SEEDED_OPENER);
  });
});

/* ====================================================================== */

describe("E: liking and commenting turned off", () => {
  let f: Flow;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setNow("2026-10-13T14:05:00Z");
    f = await onboard({ engagePosts: false }, "quiet");
    await launchStep(f.w, f.a, f.campaignId);
    await runWorker(f.w, () => f.w.linkedin.sentInvitations.length >= 1, 4 * 60);
    await drain(f.w);
  });
  afterAll(() => vi.useRealTimers());

  it("plans no likes or comments for invited prospects, even inside hours", async () => {
    expect(f.w.linkedin.sentInvitations.length).toBeGreaterThan(0);
    for (const id of invitedProviderIds(f.w)) f.w.linkedin.posts[id] = [post(id, new Date())];
    const { planned } = await planEngagement(f.w.ctx, f.w.queues, new Date());
    expect(planned).toBe(0);
    expect(f.w.db.rows("engagement_actions")).toHaveLength(0);
  });
});

/* ====================================================================== */

describe("G: a campaign writer that pastes the CTA label anyway, with the copy repair the worker runs at boot and nightly", () => {
  let f: Flow;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setNow("2026-10-13T14:05:00Z");
    f = await onboard({}, "stubborn", { stubbornWriter: true });
    await launchStep(f.w, f.a, f.campaignId);
    // The boot run and the nightly maintenance both repair stored copy
    // (rule 66); step 3 goes out five days later, after several of them.
    await repairCopy(f.w.ctx);
  });
  afterAll(() => vi.useRealTimers());

  it("the Title-Case label still never reaches the prospect in the sent follow-up", async () => {
    // The repair really ran on the pasted label, rather than the writer never pasting it.
    expect(f.w.llm.by("revise").length).toBeGreaterThan(0);
    const { first } = await walkSequence(f);
    const text = sentTo(f.w, first)[2]!;
    expect(text).toContain(DEFAULT_ANSWERS.cta.bookingUrl);
    expect(text).not.toContain(DEFAULT_ANSWERS.cta.label!);
  });
});

/* ====================================================================== */

describe("E2: likes and comments switched separately", () => {
  async function flowWith(answers: { engagePosts: boolean; engageComments: boolean }, likesSpent = false) {
    vi.useFakeTimers({ toFake: ["Date"] });
    setNow("2026-10-13T14:05:00Z");
    const f = await onboard(answers, "quiet");
    await launchStep(f.w, f.a, f.campaignId);
    await runWorker(f.w, () => f.w.linkedin.sentInvitations.length >= 1, 4 * 60);
    await drain(f.w);
    for (const id of invitedProviderIds(f.w)) f.w.linkedin.posts[id] = [post(id, new Date())];
    if (likesSpent) for (const account of f.w.db.rows("linkedin_accounts")) account.reactions_today = 25;
    await planEngagement(f.w.ctx, f.w.queues, new Date());
    const rows = f.w.db.rows("engagement_actions");
    vi.useRealTimers();
    return {
      likes: rows.filter((r) => r.kind === "reaction").length,
      comments: rows.filter((r) => r.kind === "comment").length,
    };
  }

  it("likes on, comments off: likes and no comments", async () => {
    const { likes, comments } = await flowWith({ engagePosts: true, engageComments: false });
    expect(likes).toBeGreaterThan(0);
    expect(comments).toBe(0);
  });

  it("likes off, comments on: comments and no likes", async () => {
    const { likes, comments } = await flowWith({ engagePosts: false, engageComments: true });
    expect(likes).toBe(0);
    expect(comments).toBeGreaterThan(0);
  });

  it("today's likes spent, comments on: comments still go", async () => {
    const { likes, comments } = await flowWith({ engagePosts: true, engageComments: true }, true);
    expect(likes).toBe(0);
    expect(comments).toBeGreaterThan(0);
  });
});
