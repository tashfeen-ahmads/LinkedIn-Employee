import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { createServer, strategyJobKey } from "../src/server.js";
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

/**
 * Three presses, one search.
 *
 * A customer pressed the build button three times in eight seconds and once
 * more a minute later. Four searches ran side by side, each read the prospect
 * list before any wrote to it, and four near-identical campaigns came out of
 * one approved strategy.
 */
describe("a search already running", () => {
  function queueWithState(state: { current: string | null }) {
    const db = new FakeDb();
    db.seed("memberships", [{ id: "m-1", workspace_id: WORKSPACE, user_id: USER, role: "owner" }]);
    const added: string[] = [];
    const targeting = {
      add: async (_n: string, _d: unknown, opts: { jobId: string }) => {
        added.push(opts.jobId);
        state.current = "waiting";
      },
      getJob: async () =>
        state.current === null
          ? null
          : { getState: async () => state.current, remove: async () => { state.current = null; } },
    };
    const ctx = {
      db: db.asDb(),
      linkedin: new MockLinkedInProvider(),
      email: null,
      env: { APP_URL: "http://app.test", WORKER_URL: "http://worker.test", INTERNAL_API_SECRET: INTERNAL_SECRET } as WorkerContext["env"],
      agentsFor: () => ({ client: {} as never }),
    } as unknown as WorkerContext;
    return { db, added, app: createServer(ctx, { targeting } as unknown as Queues) };
  }

  it("queues one search however many times the button is pressed", async () => {
    const state = { current: null as string | null };
    const { db, added, app } = queueWithState(state);
    for (let press = 0; press < 3; press++) expect((await queueTargeting(app)).status).toBe(200);
    expect(added).toHaveLength(1);
    expect(db.rows("events").filter((e) => e.name === "targeting.queued")).toHaveLength(1);
  });

  it("starts a fresh search once the last one has finished", async () => {
    const state = { current: null as string | null };
    const { added, app } = queueWithState(state);
    await queueTargeting(app);
    state.current = "completed";
    await queueTargeting(app);
    expect(added).toHaveLength(2);
  });
});

describe("which Strategy Agent requests count as the same one", () => {
  it("never folds a new business into onboarding's still-running first run", () => {
    const onboarding = strategyJobKey({ workspaceId: WORKSPACE, websiteUrl: "https://acme.com", description: "We sell anvils." });
    const another = strategyJobKey({ workspaceId: WORKSPACE, websiteUrl: "https://acme-two.com" });
    expect(another).not.toBe(onboarding);
    expect(strategyJobKey({ workspaceId: WORKSPACE, websiteUrl: "https://acme.com ", description: "we sell anvils." })).toBe(onboarding);
    expect(onboarding).not.toContain(":");
  });

  it("keeps expanding one business apart from expanding another", () => {
    const a = strategyJobKey({ workspaceId: WORKSPACE, expand: true, businessProfileId: "b1" });
    expect(strategyJobKey({ workspaceId: WORKSPACE, expand: true, businessProfileId: "b2" })).not.toBe(a);
    expect(strategyJobKey({ workspaceId: WORKSPACE, expand: true, businessProfileId: "b1" })).toBe(a);
  });
});
