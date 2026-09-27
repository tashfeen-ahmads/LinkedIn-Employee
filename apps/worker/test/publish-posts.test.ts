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

function harness(posts: Array<Record<string, unknown>>, accountStatus = "active") {
  const db = new FakeDb();
  db.seed("linkedin_posts", posts);
  db.seed("linkedin_accounts", [
    {
      id: "acct",
      workspace_id: WS,
      user_id: USER,
      provider_account_id: "acct_live",
      status: accountStatus,
    },
  ]);
  db.seed("events", []);
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
