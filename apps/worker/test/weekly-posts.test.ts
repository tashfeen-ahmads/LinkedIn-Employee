import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";
import { writeWeeklyPosts } from "../src/jobs/weekly-posts.js";

/*
 * A fresh set of posts each week (rule 69): written for every rep with a
 * working account in a workspace that publishes, never twice inside a week,
 * and never over a draft somebody edited.
 */

const NOW = new Date("2026-10-28T03:00:00Z");
const WS = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const C = "44444444-4444-4444-8444-444444444444";

function harness(posts: Array<Record<string, unknown>>, workspace: Record<string, unknown> = {}) {
  const db = new FakeDb();
  db.seed("workspaces", [{ id: WS, publish_posts: true, plan: "free", trial_ends_at: null, subscription_status: null, seats: 1, ...workspace }]);
  db.seed("customer_profiles", [{ id: "cp", workspace_id: WS, approved_at: "2026-09-01T00:00:00Z" }]);
  db.seed("linkedin_accounts", [
    { id: "a", workspace_id: WS, user_id: A, status: "active" },
    { id: "b", workspace_id: WS, user_id: B, status: "active" },
    { id: "c", workspace_id: WS, user_id: C, status: "active" },
  ]);
  db.seed("linkedin_posts", posts);
  const ctx = { db: db.asDb() } as unknown as WorkerContext;
  const asked: string[] = [];
  const write = (async (_ctx: WorkerContext, input: { userId: string }) => {
    asked.push(input.userId);
    return { ok: true, written: 3, replaced: 0, droppedForLinks: 0 };
  }) as never;
  return { ctx, asked, write };
}

describe("writeWeeklyPosts", () => {
  it("writes for reps whose newest post is a week old, and skips the rest", async () => {
    const { ctx, asked, write } = harness([
      // A: last set nine days ago, unread: renewed.
      { id: "1", workspace_id: WS, user_id: A, status: "draft", created_at: "2026-10-19T03:00:00Z", updated_at: "2026-10-19T03:00:00Z" },
      // B: pressed Write posts yesterday.
      { id: "2", workspace_id: WS, user_id: B, status: "draft", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-27T10:00:00Z" },
      // C: an old draft somebody edited: their work, left alone.
      { id: "3", workspace_id: WS, user_id: C, status: "draft", created_at: "2026-10-10T03:00:00Z", updated_at: "2026-10-12T09:00:00Z" },
    ]);
    const written = await writeWeeklyPosts(ctx, NOW, write);
    expect(asked).toEqual([A]);
    expect(written).toBe(3);
  });

  it("writes nothing for a workspace that switched publishing off", async () => {
    const { ctx, asked, write } = harness([], { publish_posts: false });
    await writeWeeklyPosts(ctx, NOW, write);
    expect(asked).toEqual([]);
  });
});
