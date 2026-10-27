import { describe, expect, it } from "vitest";
import { CAMPAIGN_PROMPT_VERSION, FIRST_MESSAGE_PROMPT_VERSION } from "@le/agents";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { WORKSPACE, harness } from "./loop-harness.js";

/**
 * Every sent message records the prompt that wrote it (Conventions).
 *
 * Campaign follow-ups were stored with `prompt_version` null, so a bad
 * message could not be traced to the writer, or the change, that produced it.
 */
const NOW = new Date("2026-10-07T13:00:00Z");

function followUp(campaignProspectId: string, stepNumber = 1) {
  return { kind: "follow_up" as const, workspaceId: WORKSPACE, campaignProspectId, stepNumber };
}

describe("a sent follow-up", () => {
  it("records the prompt version stored on the step that was sent", async () => {
    const { db, ctx, prospect } = harness(NOW);
    for (const step of db.rows("campaign_steps")) step.prompt_version = "targeting.campaign/2026-09-01";
    const id = prospect({ status: "accepted", next_action_at: new Date(NOW.getTime() - 60_000).toISOString() });

    await runLinkedInAction(ctx, followUp(id));

    const sent = db.rows("messages").filter((m) => m.direction === "outbound");
    expect(sent).toHaveLength(1);
    // The version that wrote these words, never the build's current constant.
    expect(sent[0]!.prompt_version).toBe("targeting.campaign/2026-09-01");
    expect(sent[0]!.prompt_version).not.toBe(CAMPAIGN_PROMPT_VERSION);
  });

  it("records no version for a step a person wrote or edited", async () => {
    const { db, ctx, prospect } = harness(NOW);
    for (const step of db.rows("campaign_steps")) step.prompt_version = null;
    const id = prospect({ status: "accepted", next_action_at: new Date(NOW.getTime() - 60_000).toISOString() });

    await runLinkedInAction(ctx, followUp(id));

    expect(db.rows("messages").find((m) => m.direction === "outbound")!.prompt_version).toBeNull();
  });

  it("records the version the personal first message was written with", async () => {
    const { db, ctx, prospect } = harness(NOW);
    const id = prospect({
      status: "accepted",
      next_action_at: new Date(NOW.getTime() - 60_000).toISOString(),
      first_message: "Thanks for accepting. How is the season treating you so far?",
      first_message_prompt_version: "first-message/2026-01-01",
    });

    await runLinkedInAction(ctx, followUp(id));

    const sent = db.rows("messages").filter((m) => m.direction === "outbound");
    expect(sent[0]!.body).toContain("How is the season");
    expect(sent[0]!.prompt_version).toBe("first-message/2026-01-01");
  });

  it("falls back to the first-message writer's current version when none was stored", async () => {
    const { db, ctx, prospect } = harness(NOW);
    const id = prospect({
      status: "accepted",
      next_action_at: new Date(NOW.getTime() - 60_000).toISOString(),
      first_message: "Thanks for accepting. How is the season treating you so far?",
      first_message_prompt_version: null,
    });

    await runLinkedInAction(ctx, followUp(id));

    expect(db.rows("messages").find((m) => m.direction === "outbound")?.prompt_version).toBe(FIRST_MESSAGE_PROMPT_VERSION);
  });
});
