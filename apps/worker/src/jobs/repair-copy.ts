import { reviseForVoice, writeHooks, writePitch } from "@le/agents";
import { DEFAULT_OPENER_TEMPLATE, voiceProblems, type MessageKind } from "@le/shared";
import { businessFor } from "../brand.js";
import { offerFrom } from "./seed-agent.js";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

/**
 * Rewrites stored copy that fails the voice check, on every campaign still
 * sending (rule 66).
 *
 * The writers check their own output now, but everything they wrote before
 * that sits in the database and goes out exactly as stored: "I'm reaching out
 * about how {{company}} handles…" was in step 1 of most running campaigns and
 * in three of every five queued connection notes. Fixing the writer changed
 * nothing anybody would receive this week.
 *
 * Only rows that fail are touched, and each write is conditional on the text
 * still being what was read, so a person editing a step meanwhile wins. A
 * revision that cannot pass, or that would drop a placeholder or a link, is
 * not stored. A personal note that cannot be fixed is cleared, so the
 * campaign's own reviewed note goes instead. Notes already sent are records
 * and never change: only `queued` people are touched.
 */

const ACTIVE = ["draft", "running", "paused"] as const;
/** Every run is bounded, so a deployment with a large backlog spreads the cost over nights. */
const MAX_REVISIONS = 400;
const CONCURRENCY = 4;

interface Item {
  workspaceId: string;
  table: "campaign_steps" | "campaigns" | "campaign_variants" | "campaign_prospects";
  column: "message" | "connection_note" | "invite_note";
  id: string;
  text: string;
  kind: MessageKind;
  template: boolean;
}

interface LooseFilter extends PromiseLike<{ error: { message: string } | null }> {
  eq(column: string, value: string): LooseFilter;
}
interface LooseTable {
  update(values: Record<string, string | null>): LooseFilter;
}

export interface RepairCopyResult {
  checked: number;
  failing: number;
  repaired: number;
  cleared: number;
  unchanged: number;
}

export async function repairCopy(ctx: WorkerContext): Promise<RepairCopyResult> {
  const { db } = ctx;
  const { data: campaigns, error } = await db
    .from("campaigns")
    .select("id, workspace_id, connection_note")
    .in("status", [...ACTIVE]);
  if (error) throw new Error(`could not read campaigns: ${error.message}`);
  const ids = (campaigns ?? []).map((c) => c.id as string);
  const result: RepairCopyResult = { checked: 0, failing: 0, repaired: 0, cleared: 0, unchanged: 0 };
  if (!ids.length) return result;

  const [steps, variants, notes] = await Promise.all([
    db.from("campaign_steps").select("id, workspace_id, step_number, message").in("campaign_id", ids),
    db.from("campaign_variants").select("id, workspace_id, connection_note").in("campaign_id", ids),
    db
      .from("campaign_prospects")
      .select("id, workspace_id, invite_note")
      .in("campaign_id", ids)
      .eq("status", "queued")
      .not("invite_note", "is", null),
  ]);
  // A read that failed is not "nothing to repair" (rule 17): stop, and try again tomorrow.
  for (const read of [steps, variants, notes]) {
    if (read.error) throw new Error(`could not read copy: ${read.error.message}`);
  }

  const items: Item[] = [
    ...(campaigns ?? []).map((c) => ({
      workspaceId: c.workspace_id as string,
      table: "campaigns" as const,
      column: "connection_note" as const,
      id: c.id as string,
      text: (c.connection_note as string | null) ?? "",
      kind: "invite_note" as const,
      template: true,
    })),
    ...(variants.data ?? []).map((v) => ({
      workspaceId: v.workspace_id as string,
      table: "campaign_variants" as const,
      column: "connection_note" as const,
      id: v.id as string,
      text: (v.connection_note as string | null) ?? "",
      kind: "invite_note" as const,
      template: true,
    })),
    ...(steps.data ?? []).map((s) => ({
      workspaceId: s.workspace_id as string,
      table: "campaign_steps" as const,
      column: "message" as const,
      id: s.id as string,
      text: (s.message as string | null) ?? "",
      kind: (s.step_number === 1 ? "first_message" : "follow_up") as MessageKind,
      template: true,
    })),
    ...(notes.data ?? []).map((n) => ({
      workspaceId: n.workspace_id as string,
      table: "campaign_prospects" as const,
      column: "invite_note" as const,
      id: n.id as string,
      text: (n.invite_note as string | null) ?? "",
      kind: "invite_note" as const,
      template: false,
    })),
  ].filter((item) => item.text.trim());

  result.checked = items.length;
  const failing = items.filter((item) => voiceProblems(item.text, item.kind, { template: item.template }).length);
  result.failing = failing.length;
  const batch = failing.slice(0, MAX_REVISIONS);

  const perWorkspace = new Map<string, { repaired: number; cleared: number; unchanged: number }>();
  const tally = (workspaceId: string, key: "repaired" | "cleared" | "unchanged") => {
    const row = perWorkspace.get(workspaceId) ?? { repaired: 0, cleared: 0, unchanged: 0 };
    row[key] += 1;
    perWorkspace.set(workspaceId, row);
    result[key] += 1;
  };

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async (item) => {
        let revised: string | null = null;
        try {
          revised = await reviseForVoice(ctx.agentsFor(item.workspaceId), {
            text: item.text,
            kind: item.kind,
            template: item.template,
          });
        } catch (err) {
          console.error("could not revise stored copy", { table: item.table, id: item.id, reason: String(err) });
        }
        // A personal note nobody could fix goes back to the campaign's own
        // note, which is reviewed copy and is repaired by this same pass.
        const next = revised ?? (item.table === "campaign_prospects" ? null : undefined);
        if (next === undefined) {
          tally(item.workspaceId, "unchanged");
          return;
        }
        // The four tables share the columns used here; the builder's types
        // cannot follow a table chosen at run time.
        let write = (db.from(item.table) as unknown as LooseTable)
          .update({ [item.column]: next })
          .eq("id", item.id)
          .eq("workspace_id", item.workspaceId)
          // Only if nobody changed it while the model was writing.
          .eq(item.column, item.text);
        if (item.table === "campaign_prospects") write = write.eq("status", "queued");
        const { error: writeError } = await write;
        if (writeError) {
          console.error("could not store revised copy", { table: item.table, id: item.id, reason: writeError.message });
          tally(item.workspaceId, "unchanged");
          return;
        }
        tally(item.workspaceId, next === null ? "cleared" : "repaired");
      }),
    );
  }

  for (const [workspaceId, counts] of perWorkspace) {
    await recordEvent(db, {
      workspaceId,
      name: "copy.repaired",
      subjectType: "workspace",
      subjectId: workspaceId,
      payload: counts,
    }).catch((err) => console.error("could not record copy.repaired", err));
  }
  return result;
}

export interface RepairSeededResult {
  offers: number;
  openers: number;
  /** Approved lines still holding the old seeded text: the owner's to change. */
  approvedLeft: number;
}

/**
 * Rewrites the offer and opener every account was seeded with, where nobody
 * has touched them.
 *
 * The seed cut the business one-liner at ninety characters ("We produce and
 * distribute short.", "Provides patient-acquisition.") and opened with "Sam
 * here regarding Lee Plumbing." Onboarding's launch step approves exactly the
 * words it shows, so a new customer approved a broken sentence on their first
 * day. Only rows still holding that exact seeded text, unapproved and written
 * by the agent, are replaced: anything a person wrote, edited or approved is
 * theirs (rule 40), and is counted rather than changed.
 */
export async function repairSeededLines(ctx: WorkerContext): Promise<RepairSeededResult> {
  const { db } = ctx;
  const result: RepairSeededResult = { offers: 0, openers: 0, approvedLeft: 0 };
  const [pitches, hooks] = await Promise.all([
    db.from("pitches").select("id, workspace_id, agent_id, body, approved_at, written_by"),
    db.from("hooks").select("id, workspace_id, agent_id, body, approved_at, written_by"),
  ]);
  if (pitches.error || hooks.error) {
    throw new Error(`could not read seeded lines: ${(pitches.error ?? hooks.error)!.message}`);
  }

  for (const row of pitches.data ?? []) {
    if (row.written_by !== "agent") continue;
    const business = await businessFor(db, row.workspace_id as string, (row.agent_id as string | null) ?? null);
    if (!business || row.body !== offerFrom(business)) continue;
    if (row.approved_at) {
      result.approvedLeft += 1;
      continue;
    }
    try {
      const set = await writePitch(ctx.agentsFor(row.workspace_id as string), { business, knowledge: [] });
      const body = set.variants[0]?.body?.trim();
      if (!body) continue;
      const { error } = await db
        .from("pitches")
        .update({ body })
        .eq("id", row.id as string)
        .eq("body", row.body as string)
        .is("approved_at", null);
      if (!error) result.offers += 1;
    } catch (err) {
      console.error("could not rewrite a seeded offer", { id: row.id, reason: String(err) });
    }
  }

  for (const row of hooks.data ?? []) {
    if (row.written_by !== "agent" || row.body !== DEFAULT_OPENER_TEMPLATE) continue;
    if (row.approved_at) {
      result.approvedLeft += 1;
      continue;
    }
    const workspaceId = row.workspace_id as string;
    const business = await businessFor(db, workspaceId, (row.agent_id as string | null) ?? null);
    if (!business) continue;
    const { data: specs } = await db
      .from("customer_profiles")
      .select("spec")
      .eq("workspace_id", workspaceId)
      .limit(5);
    const profiles = (specs ?? [])
      .map((s) => s.spec as { name?: string; summary?: string; pains?: string[] } | null)
      .filter((spec): spec is { name: string; summary?: string; pains?: string[] } => Boolean(spec?.name))
      .map((spec) => ({ name: spec.name, summary: spec.summary ?? "", pains: spec.pains ?? [] }));
    // An opener written for nobody in particular is the generic line this
    // replaces; without a segment the greeting stays.
    if (!profiles.length) continue;
    try {
      const set = await writeHooks(ctx.agentsFor(workspaceId), { business, profiles: profiles.slice(0, 3) });
      const body = set.variants[0]?.body?.trim();
      if (!body) continue;
      const { error } = await db
        .from("hooks")
        .update({ body, angle: "Written for the segment: one easy question" })
        .eq("id", row.id as string)
        .eq("body", row.body as string)
        .is("approved_at", null);
      if (!error) result.openers += 1;
    } catch (err) {
      console.error("could not rewrite a seeded opener", { id: row.id, reason: String(err) });
    }
  }
  return result;
}
