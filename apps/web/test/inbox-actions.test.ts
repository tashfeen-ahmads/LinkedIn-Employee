import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The inbox's Send, and the list it sits on.
 *
 * Asserted on the page's own source, because the faults lived in the call
 * sites (rule 39's lesson): the worker sends any draft whose status is
 * `approved`, so the only thing between a stale tab and a second identical
 * message to a real person is the condition on this one update.
 */
const page = readFileSync(join(__dirname, "../src/app/app/inbox/page.tsx"), "utf8");

function action(name: string): string {
  const start = page.indexOf(`async function ${name}`);
  expect(start, `${name} moved or was renamed`).toBeGreaterThan(-1);
  const end = page.indexOf("\nasync function", start + 10);
  return page.slice(start, end === -1 ? undefined : end);
}

describe("approving a draft", () => {
  it("only approves a draft that is still pending", () => {
    const approve = action("approveDraft");
    expect(approve).toMatch(/\.update\(\{ body, status: "approved"[\s\S]{0,300}?\.eq\("status", "pending"\)/);
  });

  it("says so, and queues nothing, when the draft had already been dealt with", () => {
    const approve = action("approveDraft");
    const guard = approve.indexOf("if (!approved?.length)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(approve.indexOf('callWorker("/jobs/send-reply"'));
  });
});

describe("the waiting list", () => {
  it("is the held conversations, the same reading as the badge", () => {
    expect(page).toContain("const conversationIds = (held ?? []).map((c) => c.id);");
  });

  it("reads the drafts for those conversations rather than the oldest in the workspace", () => {
    expect(page).toMatch(/from\("reply_drafts"\)[\s\S]{0,300}?\.in\("conversation_id", conversationIds\)/);
  });
});
