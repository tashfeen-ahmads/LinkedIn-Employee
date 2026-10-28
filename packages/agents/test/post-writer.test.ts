import { describe, expect, it } from "vitest";
import { writePosts } from "../src/post.js";
import type { AgentContext } from "../src/client.js";
import type { BusinessProfile } from "@le/shared";

/*
 * The posts are organic content for the audience's industry (rule 69). These
 * check what the writer is handed and what it refuses to pass on: a draft that
 * pitches, and a "this week" post when no week's news was supplied.
 */

function recordingCtx(parsed: Record<string, unknown>) {
  const sent: Array<{ system: string; user: string }> = [];
  const ctx = {
    workspaceId: "w",
    client: {
      models: { writer: "w", classifier: "c" },
      complete: async (request: { system: Array<{ text: string }>; user: string }) => {
        sent.push({ system: request.system.map((s) => s.text).join("\n"), user: request.user });
        return { usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, refusal: null, incomplete: null, parsed };
      },
    },
    recordCall: async () => {},
  } as unknown as AgentContext;
  return { ctx, sent };
}

const business: BusinessProfile = {
  companyName: "Acme",
  oneLiner: "Answering service for trades.",
  offering: "Call answering.",
  differentiators: [],
  proofPoints: [],
  competitors: [],
  pricingModel: "unknown",
  toneOfVoice: "plain",
  commonObjections: [],
};

const draft = (body: string, format: string) => ({ name: "n", body, angle: "a", factsUsed: [], format, visual: null });

describe("writePosts", () => {
  it("drops a draft that pitches or claims this week's news without any", async () => {
    const { ctx } = recordingCtx({
      drafts: [
        draft("Most missed calls happen at lunch, not after hours.\n\nMove your break by thirty minutes.", "insight"),
        draft("Missed calls cost jobs. We help plumbers answer every one.", "insight"),
        draft("Three things changed in plumbing this week.", "industry_update"),
        draft("A quick checklist for quoting 🚀", "checklist"),
      ],
    });
    const result = await writePosts(ctx, { business, knowledge: [] });
    expect(result.drafts.map((d) => d.body)).toEqual([
      "Most missed calls happen at lunch, not after hours.\n\nMove your break by thirty minutes.",
    ]);
    expect(result.droppedForPitch).toBe(3);
  });

  it("keeps an industry update when real headlines were supplied, and hands them over", async () => {
    const { ctx, sent } = recordingCtx({
      drafts: [draft("New licence rules for plumbers start in March, Trade Weekly reports.", "industry_update")],
    });
    const result = await writePosts(ctx, {
      business,
      knowledge: [],
      industries: ["Plumbing"],
      pains: ["Missed calls after hours"],
      news: [{ title: "New licence rules for plumbers", source: "Trade Weekly", date: "2026-10-27" }],
    });
    expect(result.drafts).toHaveLength(1);
    expect(sent[0]!.user).toContain("- Plumbing");
    expect(sent[0]!.user).toContain("- Missed calls after hours");
    expect(sent[0]!.user).toContain("New licence rules for plumbers (Trade Weekly, 2026-10-27)");
    expect(sent[0]!.system).toMatch(/NEVER A PITCH/);
  });

  it("tells the writer there is no news rather than leaving it to guess", async () => {
    const { ctx, sent } = recordingCtx({ drafts: [draft("Most calls come at lunch.", "insight")] });
    await writePosts(ctx, { business, knowledge: [] });
    expect(sent[0]!.user).toMatch(/No news was supplied this week, so do not write an industry_update/);
  });
});
