import { describe, expect, it } from "vitest";
import type { Queue } from "bullmq";
import { enqueueOnce } from "../src/queues.js";

/**
 * A double that models the one BullMQ behaviour this exists for: an `add()`
 * whose custom id is already taken adds nothing and hands back the job that
 * holds it, with no indication that it declined.
 *
 * Written rather than reused from `pipeline.test.ts`, whose queue is a bare
 * `add` — against that one every path here returns "added" and the test would
 * pass without exercising a single branch.
 */
function fakeQueue(seed: Array<{ id: string; state: string; data?: unknown }> = []) {
  const jobs = new Map<string, { id: string; state: string; data: unknown }>();
  for (const job of seed) jobs.set(job.id, { id: job.id, state: job.state, data: job.data ?? null });
  const removed: string[] = [];
  const added: Array<{ id: string; data: unknown }> = [];
  let failGetState = false;
  let failRemove = false;

  const wrap = (job: { id: string; state: string; data: unknown }) => ({
    id: job.id,
    getState: async () => {
      if (failGetState) throw new Error("redis went away mid-question");
      return job.state;
    },
    remove: async () => {
      if (failRemove) throw new Error("job is locked");
      jobs.delete(job.id);
      removed.push(job.id);
    },
  });

  const queue = {
    add: async (_name: string, data: unknown, opts: { jobId: string }) => {
      const held = jobs.get(opts.jobId);
      // BullMQ's own behaviour: the taken id wins and nothing is written.
      if (held) return wrap(held);
      const job = { id: opts.jobId, state: "delayed", data };
      jobs.set(opts.jobId, job);
      added.push({ id: opts.jobId, data });
      return wrap(job);
    },
    getJob: async (id: string) => {
      const job = jobs.get(id);
      return job ? wrap(job) : undefined;
    },
  };

  return {
    queue: queue as unknown as Queue<{ n: number }>,
    jobs,
    added,
    removed,
    breakGetState: () => (failGetState = true),
    breakRemove: () => (failRemove = true),
  };
}

const opts = (jobId: string) => ({ delay: 1000, jobId });

describe("enqueueOnce", () => {
  it("adds a job nothing is holding", async () => {
    const q = fakeQueue();

    expect(await enqueueOnce(q.queue, "invite", { n: 1 }, opts("invite--a"))).toBe("added");
    expect(q.added).toEqual([{ id: "invite--a", data: { n: 1 } }]);
  });

  it("leaves a job that is still waiting to run", async () => {
    // The dedupe this id exists for: the pacing loop runs every five minutes
    // and must not queue an invitation the previous run already queued.
    const q = fakeQueue([{ id: "invite--a", state: "delayed", data: { n: 1 } }]);

    expect(await enqueueOnce(q.queue, "invite", { n: 2 }, opts("invite--a"))).toBe("already_pending");
    expect(q.added).toEqual([]);
    expect(q.removed).toEqual([]);
    expect(q.jobs.get("invite--a")?.data).toEqual({ n: 1 });
  });

  it.each(["active", "waiting", "prioritized"])("leaves a %s job alone", async (state) => {
    const q = fakeQueue([{ id: "invite--a", state }]);

    expect(await enqueueOnce(q.queue, "invite", { n: 2 }, opts("invite--a"))).toBe("already_pending");
    expect(q.added).toEqual([]);
  });

  it.each(["completed", "failed"])("re-queues past a %s job holding the id", async (state) => {
    /*
     * The failure this was written for. Completed jobs are kept for a day and
     * failed ones for a week, so an invitation that ran and came back without
     * sending leaves its prospect at `queued` with the id held by a corpse —
     * and every tick after that adds nothing and reports the cheerful zero it
     * has always reported. Seven real people sat in that state through a full
     * working day while the loop, the queue counts and the campaign screen all
     * looked healthy.
     */
    const q = fakeQueue([{ id: "invite--a", state }]);

    expect(await enqueueOnce(q.queue, "invite", { n: 2 }, opts("invite--a"))).toBe("revived");
    expect(q.removed).toEqual(["invite--a"]);
    expect(q.added).toEqual([{ id: "invite--a", data: { n: 2 } }]);
  });

  it("does not add a second job when the state cannot be read", async () => {
    // Unknowable is not the same as stale, and acting on it is how one unit of
    // work becomes two messages to the same person.
    const q = fakeQueue([{ id: "invite--a", state: "completed" }]);
    q.breakGetState();

    expect(await enqueueOnce(q.queue, "invite", { n: 2 }, opts("invite--a"))).toBe("already_pending");
    expect(q.added).toEqual([]);
    expect(q.removed).toEqual([]);
  });

  it("does not add a second job when the stale one cannot be removed", async () => {
    // Adding after a failed remove would leave the corpse in place and the add
    // declined again — reported as a success that queued nothing.
    const q = fakeQueue([{ id: "invite--a", state: "completed" }]);
    q.breakRemove();

    expect(await enqueueOnce(q.queue, "invite", { n: 2 }, opts("invite--a"))).toBe("already_pending");
    expect(q.added).toEqual([]);
  });

  it("still adds against a queue that cannot be asked", async () => {
    // The in-memory queues elsewhere in these tests are a bare `add`. A
    // diagnostic that throws would take down the one loop that has to keep
    // running, so an unanswerable queue is treated as an empty one.
    const calls: unknown[] = [];
    const bare = { add: async (_n: string, data: unknown) => calls.push(data) } as unknown as Queue<{ n: number }>;

    expect(await enqueueOnce(bare, "invite", { n: 1 }, opts("invite--a"))).toBe("added");
    expect(calls).toEqual([{ n: 1 }]);
  });
});
