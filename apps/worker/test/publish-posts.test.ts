import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { MockLinkedInProvider } from "@le/linkedin";
import { publishApprovedPosts } from "../src/jobs/publish-posts.js";
import type { WorkerContext } from "../src/context.js";

/**
 * The sweep that puts text on a real professional's public profile.
 *
 * `mayPublish` is tested on its own in @le/shared; this is the wiring, which
 * is where it costs something. A rule that is correct in a pure function and
 * not consulted by the job is a rule that does nothing, and that gap is
 * invisible to a unit test of either half (rule 39).
 */

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-05T12:00:00Z");

function harness(
  posts: Array<Record<string, unknown>>,
  accountStatus = "active",
  rep: { working_hours?: unknown; timezone?: string } = {},
  publishPosts = true,
) {
  const db = new FakeDb();
  db.seed("workspaces", [{ id: WS, publish_posts: publishPosts, plan: "free" }]);
  db.seed("linkedin_posts", posts);
  db.seed("linkedin_accounts", [
    {
      id: "acct",
      workspace_id: WS,
      user_id: USER,
      provider_account_id: "acct_live",
      status: accountStatus,
      working_hours: rep.working_hours ?? null,
    },
  ]);
  db.seed("profiles", [{ id: USER, timezone: rep.timezone ?? null }]);
  db.seed("events", []);
  db.seed("linkedin_post_graphics", []);
  const linkedin = new MockLinkedInProvider();
  return { db, linkedin, ctx: { db: db.asDb(), linkedin } as unknown as WorkerContext };
}

const approved = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  workspace_id: WS,
  user_id: USER,
  body: "A real post.",
  status: "approved",
  approved_at: "2026-10-04T09:00:00Z",
  scheduled_for: null,
  published_at: null,
  ...over,
});

describe("publishApprovedPosts", () => {
  it("publishes nothing for a workspace whose trial has ended", async () => {
    const { ctx, db, linkedin } = harness([approved()]);
    const row = db.find("workspaces", { id: WS })!;
    Object.assign(row, { plan: "trial", trial_ends_at: "2026-10-01T00:00:00Z", subscription_status: null });
    const keys = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY", "STRIPE_PRICE_AUTOPILOT_MONTHLY", "STRIPE_PRICE_AUTOPILOT_YEARLY"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) process.env[k] = "x";
    try {
      const out = await publishApprovedPosts(ctx, NOW);
      expect(out.published).toBe(0);
      expect(linkedin.publishedPosts).toHaveLength(0);
      expect(db.find("linkedin_posts", { id: "p1" })?.status).toBe("approved");
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it("never lets posts waiting out their two days starve another workspace's", async () => {
    // Twenty posts on one profile, all spaced, plus one elsewhere: with a
    // window the size of the limit, the other workspace's post was never read.
    const other = "33333333-3333-4333-8333-333333333333";
    const { ctx, db, linkedin } = harness([
      approved({ id: "old", status: "published", published_at: "2026-10-05T11:00:00Z" }),
      ...Array.from({ length: 20 }, (_, i) => approved({ id: `w${i}`, approved_at: `2026-10-04T09:${String(i).padStart(2, "0")}:00Z` })),
      approved({ id: "theirs", workspace_id: other, user_id: "44444444-4444-4444-8444-444444444444", approved_at: "2026-10-04T10:00:00Z" }),
    ]);
    db.seed("workspaces", [{ id: other, publish_posts: true, plan: "free" }]);
    db.seed("linkedin_accounts", [
      { id: "acct2", workspace_id: other, user_id: "44444444-4444-4444-8444-444444444444", provider_account_id: "acct_2", status: "active", working_hours: null },
    ]);
    await publishApprovedPosts(ctx, NOW, 5);
    expect(linkedin.publishedPosts).toHaveLength(1);
    expect(db.find("linkedin_posts", { id: "theirs" })?.status).toBe("published");
  });

  it("reports a claim a dead run left behind, and never posts it blind", async () => {
    const { ctx, db, linkedin } = harness([approved({ published_at: "2026-10-05T11:00:00Z" })]);
    const out = await publishApprovedPosts(ctx, NOW);
    expect(out.failed).toBe(1);
    expect(linkedin.publishedPosts).toHaveLength(0);
    expect(db.find("linkedin_posts", { id: "p1" })).toMatchObject({ status: "failed", published_at: null });
  });

  it("never posts a row another run has already claimed", async () => {
    // An Approve press and the sweep reading the same row at once.
    const { ctx, linkedin } = harness([approved({ published_at: "2026-10-05T11:59:00Z", status: "approved" })]);
    const out = await publishApprovedPosts(ctx, NOW);
    expect(out.published).toBe(0);
    expect(linkedin.publishedPosts).toHaveLength(0);
  });

  it("posts once when an Approve press and the sweep run at the same moment", async () => {
    // Both runs read the row before either claims it; only one claim may win.
    const { ctx, linkedin } = harness([approved()]);
    const [a, b] = await Promise.all([publishApprovedPosts(ctx, NOW, 25, WS), publishApprovedPosts(ctx, NOW)]);
    expect(linkedin.publishedPosts).toHaveLength(1);
    expect(a.published + b.published).toBe(1);
  });

  it("publishes one post per profile every two days, never three at once", async () => {
    // What went wrong live: three approved posts went out in the same minute.
    const { ctx, db, linkedin } = harness([
      approved({ id: "p1", approved_at: "2026-10-04T09:00:00Z" }),
      approved({ id: "p2", approved_at: "2026-10-04T09:01:00Z" }),
      approved({ id: "p3", approved_at: "2026-10-04T09:02:00Z" }),
    ]);
    const first = await publishApprovedPosts(ctx, NOW);
    expect(first.published).toBe(1);
    expect(linkedin.publishedPosts).toHaveLength(1);

    // A day later, still inside the gap: nothing more.
    expect((await publishApprovedPosts(ctx, new Date("2026-10-06T12:00:00Z"))).published).toBe(0);
    // Two days after the first: the next one, and only one.
    expect((await publishApprovedPosts(ctx, new Date("2026-10-07T12:01:00Z"))).published).toBe(1);
    expect(linkedin.publishedPosts).toHaveLength(2);
    expect(db.rows("linkedin_posts").filter((row) => row.status === "approved")).toHaveLength(1);
  });

  it("holds a scheduled post that falls inside the two days after the last one", async () => {
    const { ctx, linkedin } = harness([
      approved({ id: "old", status: "published", published_at: "2026-10-04T12:00:00Z" }),
      approved({ id: "p2", scheduled_for: "2026-10-05T09:00:00Z" }),
    ]);
    const out = await publishApprovedPosts(ctx, NOW);
    expect(out.published).toBe(0);
    expect(out.held).toBe(1);
    expect(linkedin.publishedPosts).toHaveLength(0);
  });

  it("publishes an approved, due post and records what came back", async () => {
    const { ctx, db, linkedin } = harness([approved()]);
    const out = await publishApprovedPosts(ctx, NOW);

    expect(out.published).toBe(1);
    expect(linkedin.publishedPosts).toHaveLength(1);
    expect(linkedin.publishedPosts[0]!.text).toBe("A real post.");
    const row = db.find("linkedin_posts", { id: "p1" });
    expect(row?.status).toBe("published");
    expect(row?.published_at).toBeTruthy();
    expect(row?.provider_post_id).toBeTruthy();
  });

  it("publishes the picture exactly as it was approved", async () => {
    const { ctx, db, linkedin } = harness([approved({ graphic_enabled: true })]);
    const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
    db.seed("linkedin_post_graphics", [{ post_id: "p1", workspace_id: WS, png_base64: png.toString("base64") }]);

    await publishApprovedPosts(ctx, NOW);

    const sent = linkedin.publishedPosts[0]!;
    expect(sent.image?.contentType).toBe("image/png");
    expect(Buffer.from(sent.image!.data).equals(png)).toBe(true);
  });

  it("sends text only when the graphic is off, or none was approved", async () => {
    const off = harness([approved({ graphic_enabled: false })]);
    off.db.seed("linkedin_post_graphics", [{ post_id: "p1", workspace_id: WS, png_base64: "iVBORw==" }]);
    await publishApprovedPosts(off.ctx, NOW);
    expect(off.linkedin.publishedPosts[0]!.image).toBeUndefined();

    const before = harness([approved({ graphic_enabled: true })]);
    await publishApprovedPosts(before.ctx, NOW);
    expect(before.linkedin.publishedPosts[0]!.image).toBeUndefined();
  });

  it("holds the post, never sends it bare, when its picture cannot be read", async () => {
    const { db, linkedin } = harness([approved({ graphic_enabled: true })]);
    const base = db.asDb();
    const failing: Record<string, unknown> = {};
    Object.assign(failing, {
      select: () => failing,
      eq: () => failing,
      maybeSingle: async () => ({ data: null, error: { message: "timeout" } }),
    });
    const flaky = new Proxy(base, {
      get(target, prop) {
        if (prop === "from") {
          return (table: string) => (table === "linkedin_post_graphics" ? failing : (target as typeof base).from(table as never));
        }
        return Reflect.get(target, prop);
      },
    });
    const out = await publishApprovedPosts({ db: flaky, linkedin } as unknown as WorkerContext, NOW);
    expect(out.held).toBe(1);
    expect(linkedin.publishedPosts).toHaveLength(0);
    expect(db.find("linkedin_posts", { id: "p1" })?.status).toBe("approved");
  });

  it("never attaches another workspace's picture", async () => {
    const { ctx, db, linkedin } = harness([approved({ graphic_enabled: true })]);
    db.seed("linkedin_post_graphics", [{ post_id: "p1", workspace_id: "elsewhere", png_base64: "iVBORw==" }]);
    await publishApprovedPosts(ctx, NOW);
    expect(linkedin.publishedPosts[0]!.image).toBeUndefined();
  });

  it("never publishes a draft, whatever the sweep picks up", async () => {
    /*
     * The assertion this file exists for. The query asks for approved rows, but
     * a query is not a guard: a status written between the read and the send,
     * or a row half-updated by a failed approval, must not reach LinkedIn.
     */
    const { ctx, linkedin } = harness([
      approved({ id: "p1", status: "draft" }),
      approved({ id: "p2", approved_at: null }),
    ]);
    await publishApprovedPosts(ctx, NOW);
    expect(linkedin.publishedPosts, "a post nobody approved was published").toHaveLength(0);
  });

  it("holds a scheduled post instead of failing it", async () => {
    const { ctx, db, linkedin } = harness([
      approved({ scheduled_for: "2026-10-09T09:00:00Z" }),
    ]);
    const out = await publishApprovedPosts(ctx, NOW);

    expect(linkedin.publishedPosts).toHaveLength(0);
    expect(out.held).toBe(1);
    expect(out.failed).toBe(0);
    // Still approved and still waiting: a post written off as failed for being
    // early would never go out, and the rep would find a broken row whose only
    // fault was the schedule they chose.
    expect(db.find("linkedin_posts", { id: "p1" })?.status).toBe("approved");
  });

  it("never publishes the same post twice", async () => {
    const { ctx, linkedin } = harness([approved({ published_at: "2026-10-04T10:00:00Z" })]);
    await publishApprovedPosts(ctx, NOW);
    // LinkedIn has no idempotency key here, so a second attempt is a second
    // post on a real profile.
    expect(linkedin.publishedPosts).toHaveLength(0);
  });

  it("holds rather than fails when the account is not connected", async () => {
    const { ctx, db, linkedin } = harness([approved()], "reauth_required");
    const out = await publishApprovedPosts(ctx, NOW);

    expect(linkedin.publishedPosts).toHaveLength(0);
    expect(out.held).toBe(1);
    // The post is fine; the account is not. Reconnecting should be enough,
    // without asking somebody to approve the same words again.
    expect(db.find("linkedin_posts", { id: "p1" })?.status).toBe("approved");
  });

  /*
   * The wiring for the posting window, which is the half a pure test cannot
   * reach. `mayPublish` is correct about hours in @le/shared; what this asserts
   * is that the sweep passes them, and that it reads the rep's own zone rather
   * than the server's — the default that made an eight-to-six working day mean
   * four in the morning Eastern on this deployment's first live account.
   */
  it("holds a post until the rep's own day has started", async () => {
    const { ctx, db, linkedin } = harness([approved()], "active", {
      working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
      // NOW is 12:00 UTC on a Monday, which is 05:00 in Los Angeles.
      timezone: "America/Los_Angeles",
    });
    const out = await publishApprovedPosts(ctx, NOW);

    expect(linkedin.publishedPosts, "a post went out at five in the morning").toHaveLength(0);
    expect(out.held).toBe(1);
    expect(out.failed).toBe(0);
    // Still approved. Written off as failed, a post approved in the evening
    // would need approving again in the morning.
    expect(db.find("linkedin_posts", { id: "p1" })?.status).toBe("approved");
  });

  it("publishes inside the rep's own day", async () => {
    const { ctx, linkedin } = harness([approved()], "active", {
      working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
      // 13:00 in London.
      timezone: "Europe/London",
    });
    await publishApprovedPosts(ctx, NOW);
    expect(linkedin.publishedPosts).toHaveLength(1);
  });

  it("publishes at the hour the rep chose, whatever the window says", async () => {
    // "Publish when you can" means working hours; "publish at this time" is an
    // instruction, and a scheduler that ignored it would be no scheduler.
    const { ctx, linkedin } = harness([approved({ scheduled_for: "2026-10-05T11:00:00Z" })], "active", {
      working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
      timezone: "America/Los_Angeles",
    });
    await publishApprovedPosts(ctx, NOW);
    expect(linkedin.publishedPosts).toHaveLength(1);
  });

  it("leaves another workspace's queue alone when scoped to one", async () => {
    /*
     * The route passes the caller's own workspace so a click does not spend its
     * seconds on every other tenant's queue. The filter has to be in the query:
     * the worker holds the service role, so RLS will not scope it.
     */
    const other = "33333333-3333-4333-8333-333333333333";
    const { ctx, db, linkedin } = harness([
      approved({ id: "p1" }),
      approved({ id: "p2", workspace_id: other }),
    ]);
    // A workspace that could post, so only the scope can be what holds it.
    db.seed("workspaces", [{ id: other, publish_posts: true, plan: "free" }]);
    await publishApprovedPosts(ctx, NOW, 25, WS);

    expect(linkedin.publishedPosts).toHaveLength(1);
    expect(db.find("linkedin_posts", { id: "p2" })?.status).toBe("approved");
  });

  it("keeps the provider's own words when it refuses", async () => {
    const { ctx, db, linkedin } = harness([approved()]);
    linkedin.publishPost = async () => ({ ok: false, error: "422: Cannot post to this profile" });

    const out = await publishApprovedPosts(ctx, NOW);

    expect(out.failed).toBe(1);
    const row = db.find("linkedin_posts", { id: "p1" });
    expect(row?.status).toBe("failed");
    // Verbatim, because that sentence is the most useful thing in the failure
    // and it used to go to a log nobody reading the screen can reach.
    expect(row?.error).toContain("422");
  });
});

describe("the workspace's publishing switch", () => {
  it("publishes nothing while it is off, and keeps the post approved for later", async () => {
    const { db, linkedin, ctx } = harness([approved()], "active", {}, false);
    const result = await publishApprovedPosts(ctx, NOW);
    expect(result.published).toBe(0);
    expect(linkedin.publishedPosts).toHaveLength(0);
    expect(db.rows("linkedin_posts")[0]?.status).toBe("approved");
  });

  it("never lets a switched-off workspace's posts crowd out everybody else's", async () => {
    // The sweep reads the oldest approved posts; held rows that stay approved
    // would fill that window every run and stop publishing for everyone.
    const OTHER = "99999999-9999-4999-8999-999999999999";
    const crowd = Array.from({ length: 3 }, (_, i) =>
      approved({ id: `off-${i}`, workspace_id: OTHER, scheduled_for: `2026-10-0${i + 1}T09:00:00Z` }),
    );
    const { db, linkedin, ctx } = harness([...crowd, approved({ id: "mine", scheduled_for: "2026-10-04T10:00:00Z" })]);
    db.seed("workspaces", [{ id: OTHER, publish_posts: false }]);

    const out = await publishApprovedPosts(ctx, NOW, 3);

    expect(out.published).toBe(1);
    expect(linkedin.publishedPosts).toHaveLength(1);
    expect(db.find("linkedin_posts", { id: "mine" })?.status).toBe("published");
  });
});
