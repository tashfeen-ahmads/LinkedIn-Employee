import { writePitch, PITCH_PROMPT_VERSION } from "@le/agents";
import { BusinessProfileSchema } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

export interface WritePitchInput {
  workspaceId: string;
  userId: string;
  /** What the person asked to change about the pitch they are looking at. */
  instruction?: string;
}

export type WritePitchResult =
  | { ok: true; body: string; factsUsed: string[] }
  | { ok: false; reason: string };

/**
 * Writes this workspace's pitch, on the request thread, and hands back what it
 * produced.
 *
 * Synchronous rather than queued on purpose. A queued run leaves the person who
 * pressed the button looking at an unchanged page, which is indistinguishable
 * from a button that did nothing — the disease rule 25 exists for. It takes a
 * few seconds and the result is the point of the click.
 *
 * It never approves what it wrote. The row comes back with `approved_at` null
 * and the screen asks somebody to read it, exactly as rule 9 holds for the
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
    // Named, not guessed at. Without a business profile the agent would write a
    // pitch for a company it knows nothing about, which is fluent and entirely
    // invented — and it would then be offered to a person for approval as
    // though it had come from somewhere.
    return { ok: false, reason: "Tell us what you sell first — the pitch is written from your business profile." };
  }

  const [{ data: knowledge }, { data: rep }, { data: existing }] = await Promise.all([
    ctx.db
      .from("knowledge_documents")
      .select("title, content")
      .eq("workspace_id", input.workspaceId)
      .limit(20),
    ctx.db.from("profiles").select("full_name").eq("id", input.userId).maybeSingle(),
    ctx.db.from("pitches").select("body").eq("workspace_id", input.workspaceId).maybeSingle(),
  ]);

  const agents = ctx.agentsFor(input.workspaceId);
  const pitch = await writePitch(agents, {
    business: parsed.data,
    knowledge: knowledge ?? [],
    repName: rep?.full_name ?? undefined,
    instruction: input.instruction?.trim() || undefined,
    // Only when they are asking for a change. A blank instruction with the old
    // pitch attached invites a light edit of it, and "write me a new one"
    // returns the same pitch with two words moved.
    current: input.instruction?.trim() ? existing?.body ?? undefined : undefined,
  });

  const row = {
    workspace_id: input.workspaceId,
    body: pitch.body,
    written_by: "agent" as const,
    facts_used: pitch.factsUsed as never,
    // Explicit, not merely absent. This row may be replacing an approved pitch,
    // and an upsert that left the old `approved_at` in place would silently
    // send words nobody has read.
    approved_at: null,
    approved_by: null,
  };
  const { error } = await ctx.db.from("pitches").upsert(row, { onConflict: "workspace_id" });
  if (error) throw new Error(`could not save the pitch: ${error.message}`);

  await recordEvent(ctx.db, {
    workspaceId: input.workspaceId,
    name: "pitch.written",
    actorUserId: input.userId,
    subjectType: "workspace",
    subjectId: input.workspaceId,
    payload: {
      promptVersion: PITCH_PROMPT_VERSION,
      chars: pitch.body.length,
      factsUsed: pitch.factsUsed.length,
      rewrite: Boolean(input.instruction?.trim()),
      // Empty grounding is reported, not hidden — rule 16's habit. A pitch
      // that cites nothing is one the agent made up, and it looks exactly like
      // one it did not.
      grounded: pitch.factsUsed.length > 0,
    },
  }).catch((err) => console.error("could not record pitch.written", err));

  return { ok: true, body: pitch.body, factsUsed: pitch.factsUsed };
}
