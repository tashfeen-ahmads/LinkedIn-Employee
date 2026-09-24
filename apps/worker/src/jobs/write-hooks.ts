import { writeHooks, HOOK_PROMPT_VERSION } from "@le/agents";
import { BusinessProfileSchema } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

export interface WriteHooksInput {
  workspaceId: string;
  userId: string;
  instruction?: string;
  /**
   * The agent these openers belong to.
   *
   * Null is the workspace's own set, which is what every caller meant before
   * agents existed. It scopes the read, the replacement and the write alike:
   * an agent's openers are the ones somebody chose for that agent (rule: the
   * agent's own win outright), so writing a new set for one agent must not
   * delete another's drafts or quietly add to a list nobody was looking at.
   */
  agentId?: string | null;
}

export type WriteHooksResult =
  | { ok: true; written: number; kept: number }
  | { ok: false; reason: string };

/**
 * Writes this workspace's openers, on the request thread, and says what it did.
 *
 * The twin of `writeWorkspacePitch`, down to the reasons: synchronous because a
 * queued run leaves the person who clicked looking at an unchanged page, and
 * approving nothing because the agent writes copy and does not approve it.
 */
export async function writeWorkspaceHooks(
  ctx: WorkerContext,
  input: WriteHooksInput,
): Promise<WriteHooksResult> {
  const { data: profileRow } = await ctx.db
    .from("business_profiles")
    .select("spec")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const parsed = BusinessProfileSchema.safeParse(profileRow?.spec);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "Tell us what you sell first — the openers are written from your business profile.",
    };
  }

  const mine = () => {
    const q = ctx.db.from("hooks").select("id, body, approved_at").eq("workspace_id", input.workspaceId);
    return input.agentId ? q.eq("agent_id", input.agentId) : q.is("agent_id", null);
  };

  const [{ data: rep }, { data: existing }, { data: profiles }] = await Promise.all([
    ctx.db.from("profiles").select("full_name").eq("id", input.userId).maybeSingle(),
    mine(),
    // An opener is about the person receiving it, so the agent is given who
    // that is. Approved strategies only: an unapproved one describes people
    // nobody has agreed to contact.
    ctx.db
      .from("customer_profiles")
      .select("spec")
      .eq("workspace_id", input.workspaceId)
      .not("approved_at", "is", null)
      .limit(5),
  ]);

  const audiences = (profiles ?? [])
    .map((row) => row.spec as { name?: string; summary?: string; pains?: string[] } | null)
    .filter((spec): spec is { name: string; summary: string; pains: string[] } =>
      Boolean(spec?.name),
    )
    .map((spec) => ({ name: spec.name, summary: spec.summary ?? "", pains: spec.pains ?? [] }));

  if (audiences.length === 0) {
    // Named rather than guessed at. Openers written for nobody in particular
    // are the generic questions this whole mechanism exists to replace.
    return {
      ok: false,
      reason: "Approve a strategy first — an opener is written for the people it opens a conversation with.",
    };
  }

  const agents = ctx.agentsFor(input.workspaceId);
  const set = await writeHooks(agents, {
    business: parsed.data,
    profiles: audiences,
    repName: rep?.full_name ?? undefined,
    instruction: input.instruction?.trim() || undefined,
    current: input.instruction?.trim() ? (existing ?? []).map((row) => row.body) : undefined,
  });

  // Unapproved drafts are replaced wholesale; approved lines are left alone.
  // An approved opener may be attached to an angle whose results are the reason
  // the test was run, and rule 28 is explicit that a comparison which loses its
  // loser is not a comparison.
  const kept = (existing ?? []).filter((row) => row.approved_at).length;
  const stale = ctx.db.from("hooks").delete().eq("workspace_id", input.workspaceId).is("approved_at", null);
  await (input.agentId ? stale.eq("agent_id", input.agentId) : stale.is("agent_id", null));

  const rows = set.variants.map((hook) => ({
    workspace_id: input.workspaceId,
    agent_id: input.agentId ?? null,
    name: hook.name,
    body: hook.body,
    angle: hook.angle,
    written_by: "agent" as const,
    approved_at: null,
    approved_by: null,
    is_default: false,
  }));
  const { error } = await ctx.db.from("hooks").insert(rows);
  if (error) throw new Error(`could not save the openers: ${error.message}`);

  await recordEvent(ctx.db, {
    workspaceId: input.workspaceId,
    name: "hook.written",
    actorUserId: input.userId,
    subjectType: "workspace",
    subjectId: input.workspaceId,
    payload: {
      promptVersion: HOOK_PROMPT_VERSION,
      written: rows.length,
      longest: rows.reduce((max, row) => Math.max(max, row.body.length), 0),
      rewrite: Boolean(input.instruction?.trim()),
      audiences: audiences.length,
      kept,
    },
  }).catch((err) => console.error("could not record hook.written", err));

  return { ok: true, written: rows.length, kept };
}
