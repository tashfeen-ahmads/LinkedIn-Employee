import { afterEach, describe, expect, it, vi } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { ACCOUNT, CAMPAIGN, HOUR, USER, WORKSPACE, drain, harness, memoryQueue } from "./loop-harness.js";

/*
 * A profile view is bought for an invitation: it is only worth its allowance
 * if the invitation follows it inside the four hours that make it a warm-up.
 * These run the loop and the send path together across a working day or two,
 * because every way a view was wasted was invisible to either half alone.
 */

const WORKING = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
const SLOW = 60_000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function run(
  start: Date,
  hours: number,
  setup: ReturnType<typeof harness>,
  jobs = memoryQueue(),
): Promise<ReturnType<typeof memoryQueue>> {
  for (let t = start.getTime(); t <= start.getTime() + hours * HOUR; t += 5 * 60_000) {
    vi.setSystemTime(t);
    await runCampaignTick(setup.db.asDb(), jobs.queues, new Date(t));
    await drain(setup.ctx, jobs.jobs, undefined, t);
  }
  return jobs;
}

describe("a view taken late in the working day", () => {
  /*
   * The loop asked whether an invitation could follow at the *minimum* wait,
   * and the send path then drew the real wait up to three and a half hours.
   * Late in the day the wait landed after hours, no tick could place the
   * invitation, the view went stale overnight and the person was viewed a
   * second time the next morning.
   */
  async function scenario(random: number, startIso: string) {
    vi.useFakeTimers();
    const start = new Date(startIso);
    vi.setSystemTime(start);
    vi.spyOn(Math, "random").mockReturnValue(random);
    const setup = harness(start, { warmUp: true, account: { working_hours: WORKING } });
    setup.prospect();
    // Into the next afternoon, long enough for the invitation that follows.
    await run(start, 30, setup);
    return setup.linkedin;
  }

  it("is not spent twice when the wait after it is drawn long", { timeout: SLOW }, async () => {
    // Wednesday 16:00, an hour before the end of the rep's day.
    const linkedin = await scenario(0.9999, "2026-10-07T16:00:00Z");
    expect(linkedin.viewedProfiles).toHaveLength(1);
    expect(linkedin.sentInvitations).toHaveLength(1);
  });

  it("is not spent twice with an ordinary mid-range draw either", { timeout: SLOW }, async () => {
    const linkedin = await scenario(0.5, "2026-10-07T15:00:00Z");
    expect(linkedin.viewedProfiles).toHaveLength(1);
    expect(linkedin.sentInvitations).toHaveLength(1);
  });
});

describe("the loop near the end of the day", () => {
  it("queues no view whose invitation could not follow before the day ends", async () => {
    // An hour left: the shortest wait after a view, plus what the invitation
    // needs to follow it, does not fit. Queued anyway, the view job declined
    // on every tick and each decline was reported as the loop's work.
    vi.useFakeTimers();
    const now = new Date("2026-10-07T16:00:00Z");
    vi.setSystemTime(now);
    const { db, prospect } = harness(now, { warmUp: true, account: { working_hours: WORKING } });
    for (let i = 0; i < 5; i++) prospect();
    const { jobs, queues } = memoryQueue();

    expect(await runCampaignTick(db.asDb(), queues, now)).toBe(0);
    expect([...jobs.values()].filter((j) => j.data.kind === "warm_up")).toHaveLength(0);
  });

  it("queues only the views that still fit as the day runs out", async () => {
    // Two hours left, and views placed minutes apart: the later ones would
    // land with too little day behind them.
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const now = new Date("2026-10-07T15:00:00Z");
    vi.setSystemTime(now);
    const { db, prospect } = harness(now, { warmUp: true, account: { working_hours: WORKING } });
    for (let i = 0; i < 10; i++) prospect();
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, now);

    const views = [...jobs.values()].filter((j) => j.data.kind === "warm_up");
    expect(views.length).toBeGreaterThan(0);
    expect(views.length).toBeLessThan(10);
    const dayEnd = Date.parse("2026-10-07T17:00:00Z");
    for (const v of views) {
      expect(dayEnd - (v.timestamp + v.delay)).toBeGreaterThanOrEqual(LINKEDIN_LIMITS.warmUpToInviteMinMs);
    }
  });
});

describe("a warmed invitation near the end of the day", () => {
  it("is only ever sent between 45 minutes and 4 hours after a view", { timeout: SLOW }, async () => {
    /*
     * The loop clamped a warmed invitation to the warm-up window but never to
     * the end of the working day. Placed after hours, the send path deferred
     * it to the next morning and sent it there without looking at the view
     * again — cold on a seventeen-hour-old view, or minutes after the re-warm
     * the morning tick had queued meanwhile.
     */
    vi.useFakeTimers();
    const start = new Date("2026-10-07T16:55:00Z"); // five minutes before the day ends
    vi.setSystemTime(start);
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const setup = harness(start, { warmUp: true, account: { working_hours: WORKING } });
    const warmedAt = "2026-10-07T16:00:00.000Z";
    setup.prospect({ warmed_at: warmedAt, next_action_at: "2026-10-07T16:45:00.000Z" });

    // Into the next afternoon: the re-warm at nine, and the invitation after it.
    await run(start, 30, setup);

    const events = setup.db.rows("events") as Array<{ name: string; created_at: string }>;
    const sent = events.filter((e) => e.name === "invite.sent").map((e) => Date.parse(e.created_at));
    const views = [
      Date.parse(warmedAt),
      ...events.filter((e) => e.name === "prospect.warmed").map((e) => Date.parse(e.created_at)),
    ];
    expect(sent).toHaveLength(1);
    const lastViewBefore = Math.max(...views.filter((v) => v <= sent[0]!));
    const gap = sent[0]! - lastViewBefore;
    expect(gap).toBeGreaterThanOrEqual(LINKEDIN_LIMITS.warmUpToInviteMinMs);
    expect(gap).toBeLessThanOrEqual(LINKEDIN_LIMITS.warmUpToInviteMaxMs);
  });
});

describe("views against the invitations that can follow them", () => {
  it("does not view more people than can be invited while the view still counts", { timeout: SLOW }, async () => {
    /*
     * Views were budgeted against the forty-a-day view allowance only. A new
     * account (ten invitations a day) viewed forty people, invited ten, and
     * the other thirty views went stale — and those same people were viewed
     * again the next day, and the next.
     */
    vi.useFakeTimers();
    const start = new Date("2026-10-07T09:00:00Z"); // Wednesday morning
    vi.setSystemTime(start);
    const setup = harness(start, { warmUp: true, firstActionAt: null, account: { working_hours: WORKING } });
    for (let i = 0; i < 60; i++) setup.prospect();

    await run(start, 33, setup); // two working days

    const counts = new Map<string, number>();
    for (const id of setup.linkedin.viewedProfiles) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.values()].filter((n) => n > 1)).toHaveLength(0);
    // And the views were not simply withheld: each day's allowance was spent.
    expect(setup.linkedin.sentInvitations.length).toBeGreaterThanOrEqual(2 * LINKEDIN_LIMITS.invitesPerDayStart);
  });

  it("queues no more views across two campaigns than the account may make today", async () => {
    /*
     * The invitation budget was net of what every campaign on the account had
     * queued; the warm-up budget was not. Each warm-up campaign read "forty
     * left" and queued forty, the send path refused the second forty, and they
     * landed the next morning as a backlog.
     */
    vi.useFakeTimers();
    const now = new Date("2026-10-07T09:00:00Z");
    vi.setSystemTime(now);
    const OTHER = "44444444-4444-4444-8444-4444444444bb";
    const { db, prospect } = harness(now, { warmUp: true });
    db.seed("campaigns", [
      {
        id: OTHER,
        workspace_id: WORKSPACE,
        status: "running",
        linkedin_account_id: ACCOUNT,
        owner_user_id: USER,
        connection_note: "Hi.",
        daily_invite_cap: 20,
        warm_up: true,
        cta_kind: "conversation",
        cta_url: null,
      },
    ]);
    for (let i = 0; i < 50; i++) prospect();
    for (let i = 0; i < 50; i++) prospect({ campaign_id: OTHER, id: `other-${i}` });
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, now);

    const views = [...jobs.values()].filter((j) => j.data.kind === "warm_up");
    expect(views.length).toBeLessThanOrEqual(LINKEDIN_LIMITS.profileViewsPerDay);
    // Nor more than the account can invite today (thirty-five, fully ramped).
    expect(views.length).toBeLessThanOrEqual(LINKEDIN_LIMITS.invitesPerDayMax);
    void CAMPAIGN;
  });
});

describe("after LinkedIn has refused this account", () => {
  it("sends one invitation before spending any view", async () => {
    /*
     * Every time a hold ended the loop re-warmed the whole queue, the first
     * invitation was refused again, and every view was wasted: five real
     * people viewed six times each. One invitation answers the question.
     */
    vi.useFakeTimers();
    const now = new Date("2026-10-07T10:00:00Z");
    vi.setSystemTime(now);
    const { db, prospect } = harness(now, { warmUp: true, account: { invite_throttle_streak: 1 } });
    for (let i = 0; i < 10; i++) prospect();
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, now);
    await runCampaignTick(db.asDb(), queues, new Date(now.getTime() + 5 * 60_000));

    const kinds = [...jobs.values()].map((j) => j.data.kind);
    expect(kinds).toEqual(["invite"]);
  });

  it("lets that one invitation go cold, and the views resume once it works", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-07T10:00:00Z");
    vi.setSystemTime(now);
    const { db, ctx, linkedin, prospect } = harness(now, { warmUp: true, account: { invite_throttle_streak: 1 } });
    const id = prospect();
    prospect();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(linkedin.sentInvitations).toHaveLength(1);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invite_throttle_streak).toBe(0);
    const { jobs, queues } = memoryQueue();
    vi.setSystemTime(now.getTime() + 5 * 60_000);
    await runCampaignTick(db.asDb(), queues, new Date(now.getTime() + 5 * 60_000));
    expect([...jobs.values()].some((j) => j.data.kind === "warm_up")).toBe(true);
  });
});
