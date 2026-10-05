import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { pollInbound, INBOUND_POLL_BEAT } from "../src/jobs/inbound-poll.js";
import type { WorkerContext } from "../src/context.js";
import { jobId } from "../src/queues.js";

/**
 * Replies used to arrive only through the webhook. When that was refused, a
 * prospect's answer sat on LinkedIn for good — the method that could have
 * fetched it existed and nothing called it. This is the second door.
 */
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-05T12:00:00Z");

function harness(accountStatus = "active") {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  db.seed("linkedin_accounts", [
    { id: "row-1", workspace_id: WORKSPACE, user_id: "u1", provider_account_id: "acct_1", status: accountStatus },
    { id: "row-2", workspace_id: WORKSPACE, user_id: "u2", provider_account_id: null, status: "connecting" },
  ]);
  const added: Array<{ data: Record<string, unknown>; opts: { jobId: string } }> = [];
  const queues = {
    inbound: { add: async (_name: string, data: Record<string, unknown>, opts: { jobId: string }) => void added.push({ data, opts }) },
  } as never;
  const ctx = { db: db.asDb(), linkedin } as unknown as WorkerContext;
  return { db, linkedin, ctx, queues, added };
}

describe("pollInbound", () => {
  it("queues a reply the webhook never delivered, under the webhook's own job id", async () => {
    const { linkedin, ctx, queues, added } = harness();
    linkedin.inbox = [
      {
        providerMessageId: "msg-1",
        providerChatId: "chat-1",
        providerAccountId: "acct_1",
        fromProviderId: "prospect-1",
        text: "Sounds interesting — tell me more",
        receivedAt: "2026-10-04T09:00:00Z",
      },
    ];

    const result = await pollInbound(ctx, queues, NOW);

    expect(result.enqueued).toBe(1);
    expect(added[0]?.data).toMatchObject({ workspaceId: WORKSPACE, linkedinAccountId: "row-1", providerMessageId: "msg-1" });
    // Same id the webhook path uses, so a reply arriving both ways is one job.
    expect(added[0]?.opts.jobId).toBe(jobId("inbound", "msg-1"));
  });

  it("only asks about accounts that can actually receive", async () => {
    const { ctx, queues } = harness("reauth_required");
    const result = await pollInbound(ctx, queues, NOW);
    expect(result.accounts).toBe(0);
  });

  it("keeps going when the provider refuses one account, and records it", async () => {
    const { db, linkedin, ctx, queues } = harness();
    linkedin.listNewMessages = async () => {
      throw new Error("provider said no");
    };

    const result = await pollInbound(ctx, queues, NOW);

    expect(result.failed).toEqual([{ account: "row-1", error: "provider said no" }]);
    const beat = db.find("worker_heartbeats", { name: INBOUND_POLL_BEAT });
    expect((beat?.detail as { failed: unknown[] }).failed).toHaveLength(1);
  });

  it("looks back a week on its first run, so replies missed before it existed are found", async () => {
    const { linkedin, ctx, queues } = harness();
    let since = "";
    linkedin.listNewMessages = async (input: { since: string }) => {
      since = input.since;
      return [];
    };
    await pollInbound(ctx, queues, NOW);
    expect(Date.parse(since)).toBe(NOW.getTime() - 7 * 24 * 60 * 60_000);
  });
});
