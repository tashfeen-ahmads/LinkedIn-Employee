import { describe, expect, it } from "vitest";
import { REP_BIO_PREFIX } from "@le/shared";
import { carryVoiceToAgent } from "../src/lib/agent-voice";

/*
 * The voice step's answers on the agent that writes every message (rule 65).
 *
 * Sage seeds the agent at onboarding's first step, before the person has typed
 * their name and description on the fourth, so without this both were stored
 * on the profile and read by nothing that writes to a prospect.
 */

type Agent = { id: string; from_name: string | null; system_prompt: string };

function client(agent: Agent | null) {
  const updates: Array<Record<string, unknown>> = [];
  const chain = (result: () => unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: result(), error: null });
    return q;
  };
  const supabase = {
    from: () => ({
      ...chain(() => agent),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        if (agent) Object.assign(agent, patch);
        const q: Record<string, unknown> = {};
        q.eq = () => q;
        q.select = async () => ({ data: agent ? [{ id: agent.id }] : [], error: null });
        return q;
      },
    }),
  };
  return { supabase: supabase as never, updates };
}

describe("carryVoiceToAgent", () => {
  it("writes the name and description onto an agent seeded before they were given", async () => {
    const agent = { id: "a1", from_name: null, system_prompt: "Write like a person." };
    const { supabase } = client(agent);
    const ok = await carryVoiceToAgent(
      supabase,
      "w1",
      { fullName: null, bio: null },
      { fullName: "Maya Collins", bio: "I run a studio." },
    );
    expect(ok).toBe(true);
    expect(agent.from_name).toBe("Maya Collins");
    expect(agent.system_prompt).toBe(`Write like a person.\n\n${REP_BIO_PREFIX}I run a studio.`);
  });

  it("replaces what was copied from this person, and keeps a name somebody changed by hand", async () => {
    const agent = {
      id: "a1",
      from_name: "Brightloop team",
      system_prompt: `Voice.\n\n${REP_BIO_PREFIX}Old me.`,
    };
    const { supabase } = client(agent);
    await carryVoiceToAgent(supabase, "w1", { fullName: "Maya", bio: "Old me." }, { fullName: "Maya Collins", bio: "New me." });
    expect(agent.from_name).toBe("Brightloop team");
    expect(agent.system_prompt).toBe(`Voice.\n\n${REP_BIO_PREFIX}New me.`);
  });

  it("writes nothing when the agent already says it", async () => {
    const agent = { id: "a1", from_name: "Maya", system_prompt: `Voice.\n\n${REP_BIO_PREFIX}Me.` };
    const { supabase, updates } = client(agent);
    expect(await carryVoiceToAgent(supabase, "w1", { fullName: "Maya", bio: "Me." }, { fullName: "Maya", bio: "Me." })).toBe(true);
    expect(updates).toHaveLength(0);
  });
});
