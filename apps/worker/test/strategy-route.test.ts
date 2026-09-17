import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { createServer } from "../src/server.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const INTERNAL_SECRET = "internal-secret-at-least-32-characters-long";

/**
 * The note that says an agent is working.
 *
 * Onboarding's only output is the business profile, and the Strategy Agent
 * writes it minutes later. Without a record that the job was accepted, those
 * minutes look exactly like a person who never filled in the form — which is
 * what one tester was shown for twenty-one minutes, under a button that would
 * have queued the whole run a second time.
 */
function harness(options: { failEvents?: boolean } = {}) {
  const db = new FakeDb();
  db.seed("memberships", [{ id: "m-1", workspace_id: WORKSPACE, user_id: USER, role: "owner" }]);

  const real = db.asDb();
  const wrapped = options.failEvents
    ? ({
        ...real,
        from: (table: string) =>
          table === "events"
            ? { insert: async () => { throw new Error("events table unavailable"); } }
            : (real.from as (t: string) => unknown)(table),
      } as unknown as WorkerContext["db"])
    : real;

  const added: unknown[] = [];
  const ctx = {
    db: wrapped,
    linkedin: new MockLinkedInProvider(),
    email: null,
    env: { APP_URL: "http://app.test", WORKER_URL: "http://worker.test", INTERNAL_API_SECRET: INTERNAL_SECRET } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  const queues = {
    strategy: { add: async (_n: string, d: unknown) => { added.push(d); } },
    targeting: { add: async (_n: string, d: unknown) => { added.push(d); } },
  } as unknown as Queues;

  return { db, added, app: createServer(ctx, queues) };
}

function queueStrategy(app: ReturnType<typeof createServer>) {
  return app.request("/jobs/strategy", {
    method: "POST",
    body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER, description: "We sell a thing." }),
    headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
  });
}

describe("queueing the Strategy Agent", () => {
  it("records that it was asked, so the wait is visible", async () => {
    const { db, app } = harness();

    expect((await queueStrategy(app)).status).toBe(200);

    const event = db.rows("events").find((e) => e.name === "strategy.queued");
    expect(event).toBeTruthy();
    expect(event?.workspace_id).toBe(WORKSPACE);
  });

  it("still queues the run when the note cannot be written", async () => {
    // Visibility must never cost the thing it describes. A 500 here would be
    // returned for a job that was about to be accepted, and whoever pressed the
    // button would press it again — two agents, two sets of customer profiles,
    // two bills.
    const { added, app } = harness({ failEvents: true });

    expect((await queueStrategy(app)).status).toBe(200);
    expect(added).toHaveLength(1);
  });
});

function queueTargeting(app: ReturnType<typeof createServer>) {
  return app.request("/jobs/targeting", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: WORKSPACE,
      userId: USER,
      customerProfileId: "33333333-3333-4333-8333-333333333333",
      linkedinAccountId: "44444444-4444-4444-8444-444444444444",
      limit: 50,
    }),
    headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
  });
}

/**
 * Telling "never reached the worker" from "reached it and died".
 *
 * Without this note they are the same blank screen: a button pressed, no
 * banner, no event, nothing. A night went on exactly that ambiguity.
 */
describe("queueing the Targeting Agent", () => {
  it("records that it was asked", async () => {
    const { db, app } = harness();

    expect((await queueTargeting(app)).status).toBe(200);

    expect(db.rows("events").find((e) => e.name === "targeting.queued")).toBeTruthy();
  });

  it("still queues the run when the note cannot be written", async () => {
    // Visibility must never cost the thing it describes: a 500 here means the
    // button gets pressed again and two agents search.
    const { added, app } = harness({ failEvents: true });

    expect((await queueTargeting(app)).status).toBe(200);
    expect(added).toHaveLength(1);
  });
});
