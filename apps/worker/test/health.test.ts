import { describe, expect, it } from "vitest";
import type IORedis from "ioredis";
import { MockLinkedInProvider } from "@le/linkedin";
import { createServer } from "../src/server.js";
import { queueReachable } from "../src/queues.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

const SECRET = "s".repeat(48);

/**
 * The check Render uses to decide whether this deployment is healthy.
 *
 * It used to answer `{ ok: true }` without looking at anything, and this
 * deployment spent an afternoon in exactly the state that hides: process up,
 * health green, Render reporting Live, HTTP answering every request — and every
 * job queued since the morning unconsumed, because the queue was unreachable
 * and a client that retries for ever reports that as nothing at all.
 */
function makeApp(redis: Partial<IORedis> | undefined) {
  const added: Array<{ queue: string }> = [];
  const queue = (name: string) => ({
    add: async () => {
      added.push({ queue: name });
    },
  });

  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "m1" } }) }) }) }),
    }),
  } as unknown as WorkerContext["db"];

  const ctx = {
    db,
    linkedin: new MockLinkedInProvider(),
    email: null,
    env: { INTERNAL_API_SECRET: SECRET, APP_URL: "http://app.test" } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  const queues = {
    strategy: queue("strategy"),
    targeting: queue("targeting"),
    campaignTick: queue("campaignTick"),
    linkedinAction: queue("linkedinAction"),
    inbound: queue("inbound"),
    maintenance: queue("maintenance"),
  } as unknown as Queues;

  return { app: createServer(ctx, queues, redis as IORedis | undefined), added };
}

const alive = { ping: async () => "PONG" };
/** What an unreachable queue actually does: waits, rather than failing. */
const hanging = { ping: () => new Promise<string>(() => {}) };
const refusing = {
  ping: async () => {
    throw new Error("connect ECONNREFUSED");
  },
};

const tickBody = JSON.stringify({
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  campaignId: "33333333-3333-4333-8333-333333333333",
});

describe("/health", () => {
  it("is healthy when the queue answers", async () => {
    const { app } = makeApp(alive);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, queue: "reachable" });
  });

  it("is unhealthy when the queue does not answer at all", async () => {
    // The real failure mode. A retrying client does not refuse the command, it
    // keeps it — so a check that waits for an answer waits for ever, and a
    // health check that hangs tells you nothing.
    const { app } = makeApp(hanging);
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, queue: "unreachable" });
  }, 10_000);

  it("is unhealthy when the queue refuses the connection", async () => {
    const { app } = makeApp(refusing);
    expect((await app.request("/health")).status).toBe(503);
  });
});

describe("accepting work", () => {
  it("refuses a job it cannot queue, rather than answering queued", async () => {
    const { app, added } = makeApp(hanging);

    const res = await app.request("/jobs/campaign-tick", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: tickBody,
    });

    // 503 and a sentence, not a hang the caller times out on — which is the
    // same button-did-nothing that a correctly paced campaign looks like.
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/queue is unreachable/);
    expect(added).toHaveLength(0);
  }, 10_000);

  it("still takes work when the queue is there", async () => {
    const { app, added } = makeApp(alive);

    const res = await app.request("/jobs/campaign-tick", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: tickBody,
    });

    expect(res.status).toBe(200);
    expect(added).toHaveLength(1);
  });
});

describe("queueReachable", () => {
  it("gives up on a queue that never answers", async () => {
    const started = Date.now();
    expect(await queueReachable(hanging as unknown as IORedis, 50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not leave its deadline running once the queue answers", async () => {
    // A timer left armed keeps the process alive after everything is done, and
    // a worker that will not exit is a deploy that hangs.
    expect(await queueReachable(alive as unknown as IORedis, 60_000)).toBe(true);
  });
});
