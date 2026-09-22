import { writePitch, PITCH_PROMPT_VERSION } from "@le/agents";
import { BusinessProfileSchema } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

export interface WritePitchInput {
  workspaceId: string;
  userId: string;
  /** What the person asked to change about the pitches they are looking at. */
  instruction?: string;
}

export type WritePitchResult =
  | { ok: true; written: number; kept: number }
  | { ok: false; reason: string };

/**
 * Writes this workspace's pitches, on the request thread, and says what it did.
 *
 * Synchronous rather than queued on purpose. A queued run leaves the person who
 * pressed the button looking at an unchanged page, which is indistinguishable
 * from a button that did nothing — the disease rule 25 exists for. It takes a
 * few seconds and the result is the point of the click.
 *
 * It approves none of what it writes. Every row comes back with `approved_at`
 * null and the screen asks somebody to read it, exactly as rule 9 holds for the
 * customer profiles the Strategy Agent writes.
 */
export async function writeWorkspacePitch(
  ctx: WorkerContext,
  input: WritePitchInput,
): Promise<WritePitchResult> {
  const { data: profileRow } = await ctx.db
    .from("business_profiles")
    .select("spec")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const parsed = BusinessProfileSchema.safeParse(profileRow?.spec);
  if (!parsed.success) {
    // Named, not guessed at. Without a business profile the agent would write
    // pitches for a company it knows nothing about — fluent, entirely
    // invented, and then offered to a person for approval as though they had
    // come from somewhere.
    return {
      ok: false,
      reason: "Tell us what you sell first — the pitches are written from your business profile.",
    };
  }

  const [{ data: knowledge }, { data: rep }, { data: existing }, { data: profiles }] =
    await Promise.all([
      ctx.db
        .from("knowledge_documents")
        .select("title, content")
        .eq("workspace_id", input.workspaceId)
        .limit(20),
      ctx.db.from("profiles").select("full_name").eq("id", input.userId).maybeSingle(),
      ctx.db.from("pitches").select("id, body, is_default, approved_at").eq("workspace_id", input.workspaceId),
      // The opening angles a person already approved on /app/strategy. Written
      // without them, the pitches are bets nobody placed — and a prospect who
      // accepted because of one pain would hear an offer arguing another.
      ctx.db
        .from("customer_profiles")
        .select("spec")
        .eq("workspace_id", input.workspaceId)
        .not("approved_at", "is", null)
        .limit(5),
    ]);

  const hooks = (profiles ?? [])
    .flatMap((row) => {
      const spec = row.spec as { hooks?: unknown } | null;
      return Array.isArray(spec?.hooks) ? (spec.hooks as unknown[]) : [];
    })
    .filter((hook): hook is string => typeof hook === "string" && hook.trim().length > 0)
    .slice(0, 12);

  const agents = ctx.agentsFor(input.workspaceId);
  const set = await writePitch(agents, {
    business: parsed.data,
    knowledge: knowledge ?? [],
    repName: rep?.full_name ?? undefined,
    hooks,
    instruction: input.instruction?.trim() || undefined,
    // Only when they are asking for a change. A blank instruction with the old
    // lines attached invites a light edit of them, and "write me new ones"
    // returns the same four with two words moved.
    current: input.instruction?.trim() ? (existing ?? []).map((row) => row.body) : undefined,
  });

  /*
   * Unapproved drafts are replaced wholesale; approved lines are left alone.
   *
   * The set is the unit — lines written together are different bets, and two
   * old ones beside two new ones is a comparison whose arms were written
   * against different prompts. But an approved pitch may already be attached
   * to an angle whose results are the reason the test was run, and rule 28 is
   * explicit that a comparison which loses its loser is not a comparison.
   */
  const kept = (existing ?? []).filter((row) => row.approved_at).length;
  await ctx.db
    .from("pitches")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .is("approved_at", null);

  const rows = set.variants.map((pitch) => ({
    workspace_id: input.workspaceId,
    name: pitch.name,
    body: pitch.body,
    angle: pitch.angle,
    written_by: "agent" as const,
    facts_used: pitch.factsUsed as never,
    // Explicit, never merely absent: these are words nobody has read yet.
    approved_at: null,
    approved_by: null,
    is_default: false,
  }));
  const { error } = await ctx.db.from("pitches").insert(rows);
  if (error) throw new Error(`could not save the pitches: ${error.message}`);

  await recordEvent(ctx.db, {
    workspaceId: input.workspaceId,
    name: "pitch.written",
    actorUserId: input.userId,
    subjectType: "workspace",
    subjectId: input.workspaceId,
    payload: {
      promptVersion: PITCH_PROMPT_VERSION,
      written: rows.length,
      longest: rows.reduce((max, row) => Math.max(max, row.body.length), 0),
      rewrite: Boolean(input.instruction?.trim()),
      hooksUsed: hooks.length,
      kept,
      // Empty grounding is reported rather than hidden — rule 16's habit. A
      // pitch citing nothing looks exactly like one citing everything, and the
      // difference is whether a prospect is about to be told something nobody
      // can check.
      ungrounded: set.variants.filter((pitch) => pitch.factsUsed.length === 0).length,
    },
  }).catch((err) => console.error("could not record pitch.written", err));

  return { ok: true, written: rows.length, kept };
}
