import { REVISE_PROMPT_VERSION, reviseForVoice, writeHooks, writePitch } from "@le/agents";
import {
  DEFAULT_OPENER_TEMPLATE,
  campaignNameWithoutCta,
  openerProblems,
  voiceProblems,
  type MessageKind,
  type VoiceOptions,
} from "@le/shared";
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
  /**
   * The same checks the writers now run, for the campaign this copy belongs
   * to: what exists to offer, the CTA's label, and for a personal note the
   * openers it could have borrowed from (rule 40, rule 66).
   */
  checks: Omit<VoiceOptions, "template">;
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
  /** Campaign names that carried the call to action, renamed without it. */
  renamed: number;
}

export async function repairCopy(ctx: WorkerContext): Promise<RepairCopyResult> {
  const { db } = ctx;
  const { data: campaigns, error } = await db
    .from("campaigns")
    .select("id, workspace_id, name, connection_note, agent_id, customer_profile_id, cta_id, cta_label, cta_url")
    .in("status", [...ACTIVE]);
  if (error) throw new Error(`could not read campaigns: ${error.message}`);
  const ids = (campaigns ?? []).map((c) => c.id as string);
  const result: RepairCopyResult = { checked: 0, failing: 0, repaired: 0, cleared: 0, unchanged: 0, renamed: 0 };
  if (!ids.length) return result;
  const workspaceIds = [...new Set((campaigns ?? []).map((c) => c.workspace_id as string))];
  const ctaIds = [...new Set((campaigns ?? []).map((c) => c.cta_id as string | null).filter((id): id is string => Boolean(id)))];
  const profileIds = [
    ...new Set((campaigns ?? []).map((c) => c.customer_profile_id as string | null).filter((id): id is string => Boolean(id))),
  ];
  const none = Promise.resolve({ data: [] as never[], error: null });

  const [steps, variants, notes, ctas, docs, hooks, profiles] = await Promise.all([
    db.from("campaign_steps").select("id, workspace_id, campaign_id, step_number, message").in("campaign_id", ids),
    db.from("campaign_variants").select("id, workspace_id, campaign_id, connection_note, hook_id").in("campaign_id", ids),
    db
      .from("campaign_prospects")
      .select("id, workspace_id, campaign_id, variant_id, invite_note")
      .in("campaign_id", ids)
      .eq("status", "queued")
      .not("invite_note", "is", null),
    ctaIds.length ? db.from("ctas").select("id, label, url").in("id", ctaIds) : none,
    db.from("knowledge_documents").select("workspace_id, agent_id, title").in("workspace_id", workspaceIds),
    db
      .from("hooks")
      .select("id, workspace_id, body")
      .in("workspace_id", workspaceIds)
      .not("approved_at", "is", null),
    profileIds.length ? db.from("customer_profiles").select("id, spec").in("id", profileIds) : none,
  ]);
  // A read that failed is not "nothing to repair" (rule 17): stop, and try again tomorrow.
  for (const read of [steps, variants, notes, ctas, docs, hooks, profiles]) {
    if (read.error) throw new Error(`could not read copy: ${read.error.message}`);
  }

  // What each campaign may offer and what its CTA is called, read the way the
  // writer was handed them: the library entry wins over the campaign's own
  // columns (`effectiveCta`), and knowledge is the shared documents plus the
  // campaign agent's own (`knowledgeFor`).
  const ctaById = new Map(
    ((ctas.data ?? []) as Array<{ id: string; label: string | null; url: string | null }>).map((row) => [row.id, row]),
  );
  const docRows = (docs.data ?? []) as Array<{ workspace_id: string; agent_id: string | null; title: string | null }>;
  const campaignChecks = new Map<string, { workspaceId: string; checks: Omit<VoiceOptions, "template"> }>();
  for (const c of campaigns ?? []) {
    const linked = c.cta_id ? ctaById.get(c.cta_id as string) : undefined;
    const label = linked?.label ?? (c.cta_label as string | null) ?? null;
    const url = linked?.url ?? (c.cta_url as string | null) ?? null;
    const titles = docRows
      .filter((d) => d.workspace_id === c.workspace_id && (d.agent_id === null || d.agent_id === c.agent_id))
      .map((d) => d.title?.trim() ?? "");
    campaignChecks.set(c.id as string, {
      workspaceId: c.workspace_id as string,
      checks: { assets: [label ?? "", url ?? "", ...titles].filter(Boolean), ctaLabel: label },
    });
  }
  const checksFor = (campaignId: string | null | undefined) => campaignChecks.get(campaignId ?? "")?.checks ?? {};

  // The openers a queued note could have borrowed from. Its own are the
  // angle's attached opener and its strategy's; every other approved line in
  // the workspace was written for somebody else (`openerProblems`).
  const approvedByWorkspace = new Map<string, Map<string, string>>();
  for (const row of (hooks.data ?? []) as Array<{ id: string; workspace_id: string; body: string | null }>) {
    const body = row.body?.trim();
    if (!body) continue;
    const map = approvedByWorkspace.get(row.workspace_id) ?? new Map<string, string>();
    map.set(row.id, body);
    approvedByWorkspace.set(row.workspace_id, map);
  }
  const strategyHooks = new Map(
    ((profiles.data ?? []) as Array<{ id: string; spec: unknown }>).map((row) => [
      row.id,
      ((row.spec as { hooks?: unknown } | null)?.hooks as unknown[] | undefined ?? [])
        .filter((line): line is string => typeof line === "string" && Boolean(line.trim()))
        .map((line) => line.trim()),
    ]),
  );
  const variantById = new Map(
    ((variants.data ?? []) as Array<{ id: string; hook_id: string | null }>).map((row) => [row.id, row]),
  );
  const attachedHookIds = new Set(
    ((variants.data ?? []) as Array<{ hook_id: string | null }>).map((row) => row.hook_id).filter(Boolean) as string[],
  );
  const campaignById = new Map((campaigns ?? []).map((c) => [c.id as string, c]));
  const openersFor = (note: { workspace_id: string; campaign_id: string; variant_id: string | null }) => {
    const approved = approvedByWorkspace.get(note.workspace_id) ?? new Map<string, string>();
    const hookId = note.variant_id ? variantById.get(note.variant_id)?.hook_id : null;
    const profileId = campaignById.get(note.campaign_id)?.customer_profile_id as string | null | undefined;
    const own = [...(hookId && approved.get(hookId) ? [approved.get(hookId)!] : []), ...(strategyHooks.get(profileId ?? "") ?? [])];
    // Foreign only when attached to another angle: an opener attached to none
    // is this business's own line, such as the one approved on the launch
    // step, and a note leaning on it is not borrowing from anybody.
    const foreign = [...approved.entries()]
      .filter(([id, line]) => attachedHookIds.has(id) && !own.includes(line))
      .map(([, line]) => line);
    return { own, foreign };
  };

  const items: Item[] = [
    ...(campaigns ?? []).map((c) => ({
      workspaceId: c.workspace_id as string,
      table: "campaigns" as const,
      column: "connection_note" as const,
      id: c.id as string,
      text: (c.connection_note as string | null) ?? "",
      kind: "invite_note" as const,
      template: true,
      checks: checksFor(c.id as string),
    })),
    ...(variants.data ?? []).map((v) => ({
      workspaceId: v.workspace_id as string,
      table: "campaign_variants" as const,
      column: "connection_note" as const,
      id: v.id as string,
      text: (v.connection_note as string | null) ?? "",
      kind: "invite_note" as const,
      template: true,
      checks: checksFor(v.campaign_id as string),
    })),
    ...(steps.data ?? []).map((s) => ({
      workspaceId: s.workspace_id as string,
      table: "campaign_steps" as const,
      column: "message" as const,
      id: s.id as string,
      text: (s.message as string | null) ?? "",
      kind: (s.step_number === 1 ? "first_message" : "follow_up") as MessageKind,
      template: true,
      checks: checksFor(s.campaign_id as string),
    })),
    ...(notes.data ?? []).map((n) => ({
      workspaceId: n.workspace_id as string,
      table: "campaign_prospects" as const,
      column: "invite_note" as const,
      id: n.id as string,
      text: (n.invite_note as string | null) ?? "",
      kind: "invite_note" as const,
      template: false,
      // A connection request offers nothing, so no assets: the writer's own rule.
      checks: {
        openers: openersFor({
          workspace_id: n.workspace_id as string,
          campaign_id: n.campaign_id as string,
          variant_id: (n.variant_id as string | null) ?? null,
        }),
      },
    })),
  ].filter((item) => item.text.trim());

  result.checked = items.length;
  const failing = items.filter((item) => voiceProblems(item.text, item.kind, { ...item.checks, template: item.template }).length);
  result.failing = failing.length;
  const batch = failing.slice(0, MAX_REVISIONS);

  const perWorkspace = new Map<string, { repaired: number; cleared: number; unchanged: number }>();
  const tally = (workspaceId: string, key: "repaired" | "cleared" | "unchanged") => {
    const row = perWorkspace.get(workspaceId) ?? { repaired: 0, cleared: 0, unchanged: 0 };
    row[key] += 1;
    perWorkspace.set(workspaceId, row);
    result[key] += 1;
  };

  // A campaign named after its call to action ("Staffing owners (Book a Free
  // Consultation)"): the name is handed to the note writer as an angle when a
  // campaign has no other, so it is cleaned too. No model: the label is known.
  for (const c of campaigns ?? []) {
    const name = (c.name as string | null) ?? "";
    const label = campaignChecks.get(c.id as string)?.checks.ctaLabel ?? null;
    // The known label only: the name may be one a person chose (rule 66's
    // repair rewrites only what fails, and a bracket of theirs has not).
    const cleaned = campaignNameWithoutCta(name, label, { generic: false });
    if (!name || cleaned === name.trim()) continue;
    const { data: renamedRows, error: renameError } = await db
      .from("campaigns")
      .update({ name: cleaned })
      .eq("id", c.id as string)
      .eq("workspace_id", c.workspace_id as string)
      // Only if nobody renamed it meanwhile.
      .eq("name", name)
      .select("id");
    if (renameError) console.error("could not rename a campaign", { id: c.id, reason: renameError.message });
    else if (renamedRows?.length) result.renamed += 1;
  }

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async (item) => {
        let revised: string | null = null;
        // A personal note built on another audience's opener (or pasting one)
        // is about the wrong person or is a template, and the reviser has none
        // of this person's details to write a better one from. It is cleared,
        // so the angle's own reviewed note goes instead.
        const borrowed =
          item.table === "campaign_prospects" && item.checks.openers
            ? openerProblems(item.text, item.checks.openers).length > 0
            : false;
        if (!borrowed) {
          try {
            revised = await reviseForVoice(ctx.agentsFor(item.workspaceId), {
              text: item.text,
              kind: item.kind,
              template: item.template,
              assets: item.checks.assets ? [...item.checks.assets] : undefined,
              ctaLabel: item.checks.ctaLabel ?? null,
            });
          } catch (err) {
            console.error("could not revise stored copy", { table: item.table, id: item.id, reason: String(err) });
          }
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
          // A step records the prompt that wrote it, so a sent message traces
          // to this revision rather than to whichever writer built the campaign.
          .update(item.table === "campaign_steps" ? { [item.column]: next, prompt_version: REVISE_PROMPT_VERSION } : { [item.column]: next })
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
