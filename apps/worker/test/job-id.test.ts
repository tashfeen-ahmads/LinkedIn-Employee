import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jobId } from "../src/queues.js";

/**
 * The bug that meant this deployment had never sent anybody.
 *
 * BullMQ reserves `:` for its own Redis key namespacing and **rejects a custom
 * job id containing one** — by throwing from `add()`, not by falling back to a
 * generated id. Every job id in this worker was written `invite:<uuid>`, so
 * every enqueue that carried one threw: invitations, follow-ups, replies,
 * launches, inbound messages. The pacing loop failed on the first tick that
 * had real work to do, and kept failing, and the only reason anybody found out
 * is that the loop stamps its heartbeat even when it throws (rule 21) — the
 * detail read `failed: "Custom Id cannot contain :"`.
 *
 * A unit test of `jobId()` alone would not have caught it, because the bug was
 * in the call sites rather than in any helper. So this checks the source of
 * every enqueue too.
 */
describe("jobId", () => {
  it("produces an id BullMQ will accept", () => {
    expect(jobId("invite", "3f2504e0-4f89-11d3-9a0c-0305e82c3301")).not.toContain(":");
  });

  it("replaces a colon inside a part rather than dropping it", () => {
    // Dropping could map two different ids onto one, and two units of work
    // sharing an id means the second is silently skipped — a real invitation
    // that never sends.
    const a = jobId("inbound", "urn:li:message:123");
    const b = jobId("inbound", "urnlimessage:123");
    expect(a).not.toContain(":");
    expect(a).not.toBe(b);
  });

  it("keeps different work distinct", () => {
    // This id is what stops a second tick queueing an invitation the first
    // already queued, so collisions are not cosmetic.
    const ids = new Set([
      jobId("invite", "a"),
      jobId("invite", "b"),
      jobId("follow_up", "a", 1),
      jobId("follow_up", "a", 2),
      jobId("reply", "a"),
    ]);
    expect(ids.size).toBe(5);
  });

  it("is stable for the same work", () => {
    expect(jobId("invite", "a")).toBe(jobId("invite", "a"));
  });
});

describe("every enqueue in this worker", () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");

  function sources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...sources(path));
      else if (entry.name.endsWith(".ts")) found.push(path);
    }
    return found;
  }

  const FILES = sources(srcDir);

  it("finds the worker source", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  it("never writes a job id as a template literal", () => {
    /*
     * The real fix is not "no colons today", it is that nobody hand-builds one
     * of these again. A template literal is where the colon came from every
     * time, and it reads perfectly well — which is exactly why it survived
     * review in seven places.
     */
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/jobId:\s*`[^`]*`/g)) {
        offenders.push(`${file.slice(srcDir.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders, "build it with jobId() so the separator is decided in one place").toEqual([]);
  });

  it("never passes a literal colon in a job id", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/jobId:\s*"[^"]*:[^"]*"/g)) {
        offenders.push(`${file.slice(srcDir.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders, "BullMQ rejects a custom id containing a colon").toEqual([]);
  });
});
