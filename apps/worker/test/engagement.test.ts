import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider, type ProviderPost } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { planEngagement } from "../src/jobs/engagement.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/**
 * Likes and comments on prospects' posts (rule 68): planned in code, sent on
 * the one send path, held to their own allowances, and never on somebody who
 * asked to be left alone.
 */
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-09T14:00:00Z");

const post = (overrides: Partial<ProviderPost> = {}): ProviderPost => ({
  socialId: "urn:li:activity:1",
  url: "https://www.linkedin.com/feed/update/urn:li:activity:1",
  text: "We moved our dispatch team to a four-day week last spring and missed calls dropped by a third. Still working out how to cover Friday afternoons without burning anyone out.",
  postedAt: "2026-09-07T10:00:00Z",
  isRepost: false,
  canReact: true,
  canComment: false,
  ...overrides,
});

function harness(options: { status?: string; doNotContact?: boolean; engage?: boolean } = {}) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  db.seed("workspaces", [{ id: WORKSPACE, plan: "free", engage_posts: options.engage ?? true }]);
  db.seed("profiles", [{ id: USER, full_name: "Sam Patel", timezone: "UTC" }]);
  db.seed("linkedin_accounts", [
    {
      id: ACCOUNT,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider_account_id: "acct",
      status: "active",
      invites_today: 0,
      invites_this_week: 0,
      messages_today: 0,
      profile_views_today: 0,
      reactions_today: 0,
      comments_today: 0,
      counters_reset_on: "2026-09-09",
      connected_at: "2026-09-01T09:00:00Z",
      first_action_at: "2026-09-01T09:00:00Z",
      last_action_at: null,
      working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    },
  ]);
  db.seed("campaigns", [{ id: CAMPAIGN, workspace_id: WORKSPACE, linkedin_account_id: ACCOUNT, owner_user_id: USER, status: "running" }]);
  db.seed("prospects", [
    {
      id: PROSPECT,
      workspace_id: WORKSPACE,
      provider_id: "prov-1",
      first_name: "Jane",
      company: "Northwind",
      linkedin_url: "linkedin.com/in/jane",
      do_not_contact: options.doNotContact ?? false,
      last_engaged_at: null,
    },
  ]);
  db.seed("campaign_prospects", [
    {
      id: "cp-1",
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: PROSPECT,
      status: options.status ?? "accepted",
      accepted_at: "2026-09-08T10:00:00Z",
      invited_at: "2026-09-05T10:00:00Z",
    },
  ]);
  for (const t of ["engagement_actions", "events", "exclusions", "platform_settings", "worker_heartbeats"]) db.seed(t, []);
  const enqueued: Array<{ data: { kind: string; engagementId: string }; jobId: string; delay?: number }> = [];
  const queues = {
    linkedinAction: {
      add: async (_n: string, data: { kind: string; engagementId: string }, opts: { jobId: string; delay?: number }) => {
        enqueued.push({ data, jobId: opts.jobId, delay: opts.delay });
      },
    },
  } as unknown as Pick<Queues, "linkedinAction">;
  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {} as WorkerContext["env"],
    agentsFor: () => ({ client: { models: { writer: "w", classifier: "c" } } }) as never,
  } as unknown as WorkerContext;
  return { db, ctx, linkedin, queues, enqueued };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("planning", () => {
  it("plans one like on a recent post of somebody in a live conversation, on the send path", async () => {
    const { db, ctx, linkedin, queues, enqueued } = harness();
    linkedin.posts["prov-1"] = [post()];

    const { planned } = await planEngagement(ctx, queues, NOW);

    expect(planned).toBe(1);
    const row = db.rows("engagement_actions")[0]!;
    expect(row).toMatchObject({ kind: "reaction", post_id: "urn:li:activity:1", status: "queued", prospect_id: PROSPECT });
    expect(enqueued[0]?.data).toMatchObject({ kind: "engage", engagementId: row.id });
    // Placed minutes out, never this instant.
    expect(enqueued[0]?.delay).toBeGreaterThan(60_000);
  });

  it("leaves reposts, old posts and anything painful alone", async () => {
    const { ctx, linkedin, queues } = harness();
    linkedin.posts["prov-1"] = [
      post({ isRepost: true }),
      post({ postedAt: "2026-07-01T10:00:00Z" }),
      post({ text: "My father passed away last week. Thank you all for the kind words." }),
    ];
    expect((await planEngagement(ctx, queues, NOW)).planned).toBe(0);
  });

  it("never plans for somebody who opted out, was closed, or is marked do not contact", async () => {
    for (const options of [{ status: "opted_out" }, { status: "closed" }, { doNotContact: true }]) {
      const { ctx, linkedin, queues } = harness(options);
      linkedin.posts["prov-1"] = [post()];
      expect((await planEngagement(ctx, queues, NOW)).planned, JSON.stringify(options)).toBe(0);
    }
  });

  it("does nothing for a workspace that turned it off", async () => {
    const { ctx, linkedin, queues } = harness({ engage: false });
    linkedin.posts["prov-1"] = [post()];
    expect((await planEngagement(ctx, queues, NOW)).planned).toBe(0);
  });

  it("stays quiet while LinkedIn is holding the account's invitations", async () => {
    const { db, ctx, linkedin, queues } = harness();
    db.find("linkedin_accounts", { id: ACCOUNT })!.invites_paused_until = "2026-09-10T00:00:00Z";
    linkedin.posts["prov-1"] = [post()];
    expect((await planEngagement(ctx, queues, NOW)).planned).toBe(0);
  });
});

describe("sending", () => {
  async function planned() {
    const h = harness();
    h.linkedin.posts["prov-1"] = [post()];
    await planEngagement(h.ctx, h.queues, NOW);
    const id = h.db.rows("engagement_actions")[0]!.id as string;
    return { ...h, id };
  }

  it("likes the post, counts it against its own allowance, and remembers the person", async () => {
    const { db, ctx, linkedin, id } = await planned();

    await runLinkedInAction(ctx, { kind: "engage", workspaceId: WORKSPACE, engagementId: id });

    expect(linkedin.reactions).toEqual([{ accountId: "acct", postId: "urn:li:activity:1", reaction: "like" }]);
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.reactions_today).toBe(1);
    // A like is not a send: it never touches the invitation counters.
    expect(account.invites_today).toBe(0);
    expect(db.find("engagement_actions", { id })?.status).toBe("sent");
    expect(db.find("prospects", { id: PROSPECT })?.last_engaged_at).toBeTruthy();
  });

  it("skips rather than sends once somebody is marked do not contact after planning", async () => {
    const { db, ctx, linkedin, id } = await planned();
    db.find("prospects", { id: PROSPECT })!.do_not_contact = true;

    await runLinkedInAction(ctx, { kind: "engage", workspaceId: WORKSPACE, engagementId: id });

    expect(linkedin.reactions).toHaveLength(0);
    expect(db.find("engagement_actions", { id })?.status).toBe("skipped");
  });

  it("skips once the day's likes are spent, rather than queueing them for an older post tomorrow", async () => {
    const { db, ctx, linkedin, id } = await planned();
    db.find("linkedin_accounts", { id: ACCOUNT })!.reactions_today = 25;

    await runLinkedInAction(ctx, { kind: "engage", workspaceId: WORKSPACE, engagementId: id });

    expect(linkedin.reactions).toHaveLength(0);
    expect(db.find("engagement_actions", { id })?.status).toBe("skipped");
  });

  it("records a refusal in the provider's words instead of throwing", async () => {
    const { db, ctx, linkedin, id } = await planned();
    linkedin.engageError = "Post not found";

    await runLinkedInAction(ctx, { kind: "engage", workspaceId: WORKSPACE, engagementId: id });

    expect(db.find("engagement_actions", { id })).toMatchObject({ status: "failed", reason: "Post not found" });
  });
});
