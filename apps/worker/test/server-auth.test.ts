import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { createServer } from "../src/server.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

const SECRET = "s".repeat(48);

function makeApp({
  secret,
  isMember = true,
}: { secret: string | undefined; isMember?: boolean } = { secret: SECRET }) {
  const added: Array<{ queue: string; data: unknown }> = [];
  const queue = (name: string) => ({
    add: async (_jobName: string, data: unknown) => {
      added.push({ queue: name, data });
    },
  });

  // Minimal stub: every endpoint under test asks the same membership question.
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: isMember ? { id: "m1" } : null }) }),
        }),
      }),
    }),
  } as unknown as WorkerContext["db"];

  const ctx = {
    db,
    linkedin: new MockLinkedInProvider(),
    email: null,
    env: {
      INTERNAL_API_SECRET: secret,
      APP_URL: "http://app.test",
      WORKER_URL: "http://worker.test",
    } as WorkerContext["env"],
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

  return { app: createServer(ctx, queues), added };
}

const validStrategyBody = JSON.stringify({
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  websiteUrl: "https://acme.test",
});

describe("internal API authentication", () => {
  it("rejects a job request with no credentials", async () => {
    const { app, added } = makeApp();
    const res = await app.request("/jobs/strategy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: validStrategyBody,
    });

    expect(res.status).toBe(401);
    // The important part: nothing was enqueued for a workspace the caller
    // merely named.
    expect(added).toHaveLength(0);
  });

  it("rejects a wrong secret", async () => {
    const { app } = makeApp();
    const res = await app.request("/jobs/strategy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: validStrategyBody,
    });
    expect(res.status).toBe(401);
  });

  it("accepts the shared secret", async () => {
    const { app, added } = makeApp();
    const res = await app.request("/jobs/strategy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: validStrategyBody,
    });

    expect(res.status).toBe(200);
    expect(added).toHaveLength(1);
  });

  it("guards the account-linking endpoints, not just job dispatch", async () => {
    const { app } = makeApp();
    for (const path of ["/auth/linkedin/link", "/auth/google/link", "/auth/hubspot/link"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "11111111-1111-4111-8111-111111111111",
          userId: "22222222-2222-4222-8222-222222222222",
        }),
      });
      expect(res.status, path).toBe(401);
    }
  });

  it("fails closed when no secret is configured", async () => {
    const { app, added } = makeApp({ secret: undefined });
    const res = await app.request("/jobs/strategy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anything" },
      body: validStrategyBody,
    });

    expect(res.status).toBe(503);
    expect(added).toHaveLength(0);
  });

  it("refuses a workspace the named user does not belong to", async () => {
    // Second lock: even with the shared secret, the worker will not bind
    // credentials to a workspace the user is not a member of.
    const { app, added } = makeApp({ secret: SECRET, isMember: false });
    const res = await app.request("/jobs/strategy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: validStrategyBody,
    });

    expect(res.status).toBe(403);
    expect(added).toHaveLength(0);
  });

  it("guards account linking against non-members too", async () => {
    const { app } = makeApp({ secret: SECRET, isMember: false });
    const res = await app.request("/auth/linkedin/link", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("leaves the health check open", async () => {
    const { app } = makeApp();
    expect((await app.request("/health")).status).toBe(200);
  });
});

describe("request validation", () => {
  it("rejects a strategy request with nothing to work from", async () => {
    const { app, added } = makeApp();
    const res = await app.request("/jobs/strategy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    });

    // Otherwise this becomes three failed queue attempts and a dead job nobody
    // ever sees, instead of an answer the caller can act on.
    expect(res.status).toBe(400);
    expect(added).toHaveLength(0);
  });

  it("accepts a strategy request carrying only a description", async () => {
    const { app, added } = makeApp();
    const res = await app.request("/jobs/strategy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        description: "We sell revenue tooling to B2B teams.",
      }),
    });

    expect(res.status).toBe(200);
    expect(added).toHaveLength(1);
  });
});
