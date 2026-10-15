import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fetchAllRows } from "@le/db";
import {
  AgentPlaybookSchema,
  BusinessProfileSchema,
  CustomFieldSchema,
  HOOK_MAX_CHARS,
  MAX_STRATEGY_PRIORITY,
  MODEL_PRICING,
  PITCH_MAX_CHARS,
  checkCtaUrl,
  containsLink,
  normalizeExclusionValue,
  normalizeLinkedInUrl,
  parseCustomerProfile,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { EXPORT_VERSION } from "./retention.js";

/**
 * Bringing a workspace export back in — configuration and suppression only.
 *
 * The export (`exportWorkspace`) is a faithful copy of everything, and most of
 * it must never come back through a file. Prospects, campaigns, conversations,
 * messages and meetings are other people's personal data and the record of
 * what was said to them; a file that could write those would be a way to
 * forge a history. Members are sign-in rights, and a file is not a way to
 * grant somebody access. So what comes in is what a business would otherwise
 * have to retype: its agents, knowledge, destinations, pitches, openers, its
 * business profile and its strategies — and its promises.
 *
 * The promises are the part that cannot be lost in a move. Somebody who asked
 * not to be contacted (rule 7) and somebody already contacted (rule 24) are
 * carried over as `person` exclusions by profile address, which is what the
 * send path checks immediately before every send (rule 14). That keeps the
 * suppression without importing a single prospect record: no name, no
 * employer, no conversation — the address alone, which is what matching reads.
 *
 * Three things are never trusted from the file:
 *
 * - **Whose it is.** Every row is written to the caller's workspace, whatever
 *   `workspace_id` the file names, and every id is freshly generated. The
 *   file's ids are used only to rewire the file's own references to one
 *   another (an agent's knowledge, pitches and openers; a strategy's CTA), and
 *   a reference to anything the file did not bring is dropped rather than
 *   followed.
 * - **Approval.** An approval is a statement by a person about particular text
 *   in a particular workspace (rules 9 and 40). Strategies, pitches, openers
 *   and the business profile all arrive unapproved and nothing arrives as a
 *   default, so nothing imported is searched for or sent until somebody here
 *   has read it.
 * - **Normalized values.** An exclusion's matching key is recomputed from what
 *   was typed, because matching is only as good as one definition of "the same
 *   company" governing both storage and comparison.
 *
 * Re-importing the same file adds nothing twice: exclusions dedupe on their
 * own unique key, and every other row is skipped when one with the same name,
 * title or words is already here.
 */

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const text = (max: number) => z.string().max(max);
const optionalText = (max: number) => z.string().max(max).nullish();
const anyId = z.string().max(100).nullish();

const ExclusionIn = z.object({
  kind: z.enum(["company", "person"]),
  raw_value: optionalText(500),
  value: optionalText(500),
  reason: optionalText(200),
});

const KnowledgeIn = z.object({
  agent_id: anyId,
  title: text(300),
  content: text(500_000),
  source: optionalText(2000),
});

const CtaIn = z.object({
  id: anyId,
  name: text(120),
  kind: z.enum(["meeting", "link", "reply"]),
  label: optionalText(200),
  url: optionalText(2000),
  archived_at: optionalText(64),
});

const AgentIn = z.object({
  id: anyId,
  name: text(80),
  model: optionalText(80),
  system_prompt: optionalText(20_000),
  from_name: optionalText(120),
  playbook: z.unknown().optional(),
  custom_fields: z.unknown().optional(),
  archived_at: optionalText(64),
});

const LineIn = z.object({
  agent_id: anyId,
  name: text(120),
  body: text(2000),
  angle: optionalText(500),
  written_by: z.enum(["agent", "human"]).nullish(),
  facts_used: z.array(z.string().max(500)).max(50).nullish(),
});

const BusinessProfileIn = z.object({
  website_url: optionalText(2000),
  linkedin_company_url: optionalText(2000),
  spec: z.unknown(),
});

const CustomerProfileIn = z.object({
  name: text(200),
  spec: z.unknown(),
  priority: z.number().int().min(0).max(1000).nullish(),
  do_not_pursue: z.boolean().nullish(),
  cta_kind: z.enum(["meeting", "link", "reply"]).nullish(),
  cta_label: optionalText(200),
  cta_url: optionalText(2000),
  cta_id: anyId,
});

/** Read for its suppression facts and nothing else; every other column is stripped. */
const ProspectIn = z.object({
  linkedin_url: optionalText(500),
  do_not_contact: z.boolean().nullish(),
  last_contacted_at: optionalText(64),
});

const list = <T extends z.ZodTypeAny>(row: T, max: number) => z.array(row).max(max).default([]);

export const ImportFileSchema = z.object({
  exportVersion: z.literal(EXPORT_VERSION),
  exclusions: list(ExclusionIn, 50_000),
  knowledgeDocuments: list(KnowledgeIn, 2_000),
  ctas: list(CtaIn, 500),
  agents: list(AgentIn, 200),
  pitches: list(LineIn, 1_000),
  hooks: list(LineIn, 1_000),
  businessProfiles: list(BusinessProfileIn, 50),
  customerProfiles: list(CustomerProfileIn, 500),
  prospects: list(ProspectIn, 200_000),
});
export type ImportFile = z.infer<typeof ImportFileSchema>;

export type ImportTable =
  | "exclusions"
  | "suppression"
  | "knowledgeDocuments"
  | "ctas"
  | "agents"
  | "pitches"
  | "hooks"
  | "businessProfile"
  | "customerProfiles";

export interface ImportCount {
  added: number;
  skipped: number;
}

export type ImportResult =
  | {
      ok: true;
      counts: Record<ImportTable, ImportCount>;
      /** Rows that need a person to approve them here before anything uses them. */
      awaitingApproval: number;
      summary: string;
    }
  | { ok: false; error: string };

/**
 * Checks the file's shape and version, in words somebody can act on.
 *
 * The version is looked at before anything else, so a file from a different
 * shape is told so plainly instead of being reported as a list of fields.
 */
export function readImportFile(raw: unknown): { ok: true; file: ImportFile } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "That file is not a workspace export." };
  }
  const version = (raw as { exportVersion?: unknown }).exportVersion;
  if (version === undefined) return { ok: false, error: "That file is not a workspace export." };
  if (version !== EXPORT_VERSION) {
    return {
      ok: false,
      error: `That export is version ${String(version).slice(0, 20)}, and only version ${EXPORT_VERSION} can be imported. Download a fresh export and try again.`,
    };
  }
  const parsed = ImportFileSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.slice(0, 2).join(" › ") ?? "";
    return {
      ok: false,
      error: `That export could not be read${where ? ` (at ${where})` : ""}. Nothing was imported.`,
    };
  }
  return { ok: true, file: parsed.data };
}

const key = (value: string) => value.trim().toLowerCase();

const zero = (): ImportCount => ({ added: 0, skipped: 0 });

/** A thrown database error, said as one sentence for whoever pressed the button. */
class ImportWriteError extends Error {}

async function insertAll(
  ctx: WorkerContext,
  table: "agents" | "ctas" | "knowledge_documents" | "pitches" | "hooks" | "business_profiles" | "customer_profiles",
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await ctx.db.from(table).insert(rows.slice(i, i + 500) as never);
    if (error) {
      console.error(`import: ${table} insert failed`, error.message);
      throw new ImportWriteError(table);
    }
  }
}

/**
 * Imports configuration and suppression into the caller's workspace.
 *
 * `workspaceId` and `userId` come from the signed-in session through the
 * internal API; nothing in `raw` can change either.
 */
export async function importWorkspace(
  ctx: WorkerContext,
  input: { workspaceId: string; userId: string; raw: unknown },
): Promise<ImportResult> {
  const read = readImportFile(input.raw);
  if (!read.ok) return read;
  const { file } = read;
  const { db } = ctx;
  const ws = input.workspaceId;
  const now = new Date().toISOString();

  const counts: Record<ImportTable, ImportCount> = {
    exclusions: zero(),
    suppression: zero(),
    knowledgeDocuments: zero(),
    ctas: zero(),
    agents: zero(),
    pitches: zero(),
    hooks: zero(),
    businessProfile: zero(),
    customerProfiles: zero(),
  };
  let awaitingApproval = 0;

  // What is already here, so a second import of the same file adds nothing.
  const [existingAgents, existingCtas, existingKnowledge, existingPitches, existingHooks, existingBusiness, existingStrategies] =
    await Promise.all([
      db.from("agents").select("id, name").eq("workspace_id", ws),
      db.from("ctas").select("id, name").eq("workspace_id", ws),
      db.from("knowledge_documents").select("title").eq("workspace_id", ws),
      db.from("pitches").select("body").eq("workspace_id", ws),
      db.from("hooks").select("body").eq("workspace_id", ws),
      db.from("business_profiles").select("id").eq("workspace_id", ws).order("created_at", { ascending: true }).limit(1),
      db.from("customer_profiles").select("name, priority").eq("workspace_id", ws),
    ]);
  // Paged: the exclusion list is the one of these that passes a thousand rows,
  // and a capped read would count every entry past it as new.
  const existingExclusions = await fetchAllRows<{ kind: string; value: string }>((from, to) =>
    db
      .from("exclusions")
      .select("kind, value")
      .eq("workspace_id", ws)
      .order("id", { ascending: true })
      .range(from, to) as never,
  ).catch((error: Error) => ({ error }));
  const firstError =
    [existingAgents, existingCtas, existingKnowledge, existingPitches, existingHooks, existingBusiness, existingStrategies]
      .map((r) => r.error)
      .find(Boolean) ?? ("error" in existingExclusions ? existingExclusions.error : null);
  if (firstError || "error" in existingExclusions) {
    // Unreadable is not empty: importing against a list we could not see is
    // how every row arrives twice.
    console.error("import: could not read the workspace", firstError?.message);
    return { ok: false, error: "This workspace could not be read just now, so nothing was imported. Please try again." };
  }

  try {
    // ---- Agents. Matched by name; the file's id maps to whichever row holds it here.
    const agentIds = new Map<string, string>();
    const agentByName = new Map((existingAgents.data ?? []).map((a) => [key(a.name), a.id] as const));
    const newAgents: Record<string, unknown>[] = [];
    for (const agent of file.agents) {
      const name = agent.name.trim();
      if (!name) {
        counts.agents.skipped += 1;
        continue;
      }
      const already = agentByName.get(key(name));
      if (already) {
        if (agent.id) agentIds.set(agent.id, already);
        counts.agents.skipped += 1;
        continue;
      }
      const id = randomUUID();
      if (agent.id) agentIds.set(agent.id, id);
      agentByName.set(key(name), id);
      const playbook = AgentPlaybookSchema.safeParse(agent.playbook ?? {});
      const fields = z.array(CustomFieldSchema).max(30).safeParse(agent.custom_fields ?? []);
      newAgents.push({
        id,
        workspace_id: ws,
        name,
        // A model nobody can price cannot be run (rule: pricing.ts).
        model: agent.model && agent.model in MODEL_PRICING ? agent.model : null,
        system_prompt: agent.system_prompt ?? null,
        from_name: agent.from_name ?? null,
        playbook: playbook.success ? playbook.data : AgentPlaybookSchema.parse({}),
        custom_fields: fields.success ? fields.data : [],
        // The workspace's default agent is a choice made here, not in the file.
        is_default: false,
        archived_at: agent.archived_at ? now : null,
      });
      counts.agents.added += 1;
    }
    await insertAll(ctx, "agents", newAgents);
    /** An agent reference the file did not bring becomes workspace-wide, never someone else's id. */
    const agentFor = (old: string | null | undefined) => (old ? agentIds.get(old) ?? null : null);

    // ---- CTAs. Matched by name.
    const ctaIds = new Map<string, string>();
    const ctaByName = new Map((existingCtas.data ?? []).map((c) => [key(c.name), c.id] as const));
    const newCtas: Record<string, unknown>[] = [];
    for (const cta of file.ctas) {
      const name = cta.name.trim();
      if (!name) {
        counts.ctas.skipped += 1;
        continue;
      }
      const already = ctaByName.get(key(name));
      if (already) {
        if (cta.id) ctaIds.set(cta.id, already);
        counts.ctas.skipped += 1;
        continue;
      }
      const url = cta.url ? checkCtaUrl(cta.url) : null;
      const id = randomUUID();
      if (cta.id) ctaIds.set(cta.id, id);
      ctaByName.set(key(name), id);
      newCtas.push({
        id,
        workspace_id: ws,
        name,
        kind: cta.kind,
        label: cta.label ?? null,
        url: url?.ok ? url.url : null,
        archived_at: cta.archived_at ? now : null,
        created_by: input.userId,
      });
      counts.ctas.added += 1;
    }
    await insertAll(ctx, "ctas", newCtas);

    // ---- Knowledge. Matched by title. Never shortened (rule 11): a document
    // too long for the schema above fails the whole file rather than arriving cut.
    const titles = new Set((existingKnowledge.data ?? []).map((d) => key(d.title)));
    const newKnowledge: Record<string, unknown>[] = [];
    for (const doc of file.knowledgeDocuments) {
      const title = doc.title.trim();
      if (!title || !doc.content.trim() || titles.has(key(title))) {
        counts.knowledgeDocuments.skipped += 1;
        continue;
      }
      titles.add(key(title));
      newKnowledge.push({
        id: randomUUID(),
        workspace_id: ws,
        title,
        content: doc.content,
        source: doc.source ?? null,
        agent_id: agentFor(doc.agent_id),
      });
      counts.knowledgeDocuments.added += 1;
    }
    await insertAll(ctx, "knowledge_documents", newKnowledge);

    // ---- Pitches and openers. Matched by their words. Unapproved, never the
    // default (rule 40); over-length lines are dropped, never truncated.
    const lines = (
      rows: ImportFile["pitches"],
      existing: Array<{ body: string }>,
      maxChars: number,
      count: ImportCount,
      /** True for pitches, which may carry an approved link (rule 30); false for openers. */
      allowLink: boolean,
    ): Record<string, unknown>[] => {
      const bodies = new Set(existing.map((r) => key(r.body)));
      const out: Record<string, unknown>[] = [];
      for (const row of rows) {
        const body = row.body.trim();
        if (!body || body.length > maxChars || bodies.has(key(body)) || (!allowLink && containsLink(body))) {
          count.skipped += 1;
          continue;
        }
        bodies.add(key(body));
        out.push({
          id: randomUUID(),
          workspace_id: ws,
          name: row.name.trim() || "Imported",
          body,
          angle: row.angle ?? null,
          written_by: row.written_by ?? "human",
          approved_at: null,
          approved_by: null,
          is_default: false,
          agent_id: agentFor(row.agent_id),
          // Pitches only: an opener has no facts column.
          ...(allowLink ? { facts_used: row.facts_used ?? [] } : {}),
        });
        count.added += 1;
      }
      return out;
    };
    const newPitches = lines(file.pitches, existingPitches.data ?? [], PITCH_MAX_CHARS, counts.pitches, true);
    // An opener carries no link (rule 40): it is spoken inside a connection request.
    const newHooks = lines(file.hooks, existingHooks.data ?? [], HOOK_MAX_CHARS, counts.hooks, false);
    await insertAll(ctx, "pitches", newPitches);
    await insertAll(ctx, "hooks", newHooks);
    awaitingApproval += newPitches.length + newHooks.length;

    // ---- Business profile: only where there is none. Two would split the
    // strategies across both (rule 37).
    let businessProfileId: string | null = existingBusiness.data?.[0]?.id ?? null;
    if (businessProfileId) {
      counts.businessProfile.skipped += file.businessProfiles.length;
    } else {
      const usable = file.businessProfiles.find((b) => BusinessProfileSchema.safeParse(b.spec).success);
      counts.businessProfile.skipped += file.businessProfiles.length - (usable ? 1 : 0);
      if (usable) {
        businessProfileId = randomUUID();
        await insertAll(ctx, "business_profiles", [
          {
            id: businessProfileId,
            workspace_id: ws,
            website_url: usable.website_url ?? null,
            linkedin_company_url: usable.linkedin_company_url ?? null,
            spec: usable.spec,
            approved_at: null,
            created_by: input.userId,
          },
        ]);
        counts.businessProfile.added = 1;
        awaitingApproval += 1;
      }
    }

    // ---- Strategies. Matched by name; unapproved (rule 9); priorities
    // continue from the end of the list (rule 37). A spec nothing can read is
    // skipped rather than stored to throw in targeting later.
    const strategyNames = new Set((existingStrategies.data ?? []).map((s) => key(s.name)));
    let priority = Math.max(0, ...(existingStrategies.data ?? []).map((s) => s.priority ?? 0));
    const ordered = [...file.customerProfiles].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    const newStrategies: Record<string, unknown>[] = [];
    for (const profile of ordered) {
      const name = profile.name.trim();
      if (!businessProfileId || !name || strategyNames.has(key(name)) || !parseCustomerProfile(profile.spec).success) {
        counts.customerProfiles.skipped += 1;
        continue;
      }
      strategyNames.add(key(name));
      priority = Math.min(MAX_STRATEGY_PRIORITY, priority + 1);
      const url = profile.cta_url ? checkCtaUrl(profile.cta_url) : null;
      newStrategies.push({
        id: randomUUID(),
        workspace_id: ws,
        business_profile_id: businessProfileId,
        name,
        // The spec carries its own priority, kept equal to the row's as the
        // Strategy Agent keeps it.
        spec: { ...(profile.spec as Record<string, unknown>), priority },
        priority,
        do_not_pursue: profile.do_not_pursue ?? false,
        approved_at: null,
        cta_kind: profile.cta_kind ?? "meeting",
        cta_label: profile.cta_label ?? null,
        cta_url: url?.ok ? url.url : null,
        cta_id: profile.cta_id ? ctaIds.get(profile.cta_id) ?? null : null,
        search_position: null,
      });
      counts.customerProfiles.added += 1;
    }
    await insertAll(ctx, "customer_profiles", newStrategies);
    awaitingApproval += newStrategies.length;

    // ---- Exclusions, and suppression carried over as exclusions.
    const seen = new Set(existingExclusions.rows.map((e) => `${e.kind}|${e.value}`));
    const newExclusions: Record<string, unknown>[] = [];
    const exclude = (kind: "company" | "person", raw: string, reason: string | null, count: ImportCount) => {
      const rawValue = raw.trim();
      const value = rawValue ? normalizeExclusionValue(kind, rawValue) : "";
      if (!value || seen.has(`${kind}|${value}`)) {
        count.skipped += 1;
        return;
      }
      seen.add(`${kind}|${value}`);
      newExclusions.push({ workspace_id: ws, kind, value, raw_value: rawValue, reason, created_by: input.userId });
      count.added += 1;
    };
    for (const row of file.exclusions) {
      exclude(row.kind, row.raw_value ?? row.value ?? "", row.reason ?? null, counts.exclusions);
    }
    for (const prospect of file.prospects) {
      if (!prospect.do_not_contact && !prospect.last_contacted_at) continue;
      if (!prospect.linkedin_url || !normalizeLinkedInUrl(prospect.linkedin_url)) {
        counts.suppression.skipped += 1;
        continue;
      }
      exclude(
        "person",
        prospect.linkedin_url,
        prospect.do_not_contact ? "Asked not to be contacted (carried over from an export)" : "Already contacted (carried over from an export)",
        counts.suppression,
      );
    }
    for (let i = 0; i < newExclusions.length; i += 500) {
      // `ignoreDuplicates` on the table's own unique key, so an entry added by
      // somebody else while this ran is left exactly as they wrote it.
      const { error } = await db
        .from("exclusions")
        .upsert(newExclusions.slice(i, i + 500) as never, { onConflict: "workspace_id,kind,value", ignoreDuplicates: true });
      if (error) {
        console.error("import: exclusions upsert failed", error.message);
        throw new ImportWriteError("exclusions");
      }
    }
  } catch (error) {
    if (!(error instanceof ImportWriteError)) throw error;
    return {
      ok: false,
      error: `The import stopped part of the way through. ${describeCounts(counts)} Importing the same file again finishes it without adding anything twice.`,
    };
  }

  await recordEvent(db, {
    workspaceId: ws,
    name: "workspace.imported",
    actorUserId: input.userId,
    // Counts only: never a name, an address or a line of copy.
    payload: { counts, awaitingApproval },
  });

  return { ok: true, counts, awaitingApproval, summary: summarizeImport(counts, awaitingApproval) };
}

const LABELS: Record<ImportTable, [string, string]> = {
  exclusions: ["exclusion", "exclusions"],
  suppression: ["person already contacted or asking not to be", "people already contacted or asking not to be"],
  knowledgeDocuments: ["knowledge document", "knowledge documents"],
  ctas: ["call to action", "calls to action"],
  agents: ["agent", "agents"],
  pitches: ["pitch", "pitches"],
  hooks: ["opener", "openers"],
  businessProfile: ["business profile", "business profiles"],
  customerProfiles: ["strategy", "strategies"],
};

function describeCounts(counts: Record<ImportTable, ImportCount>): string {
  const added = (Object.keys(LABELS) as ImportTable[])
    .filter((t) => counts[t].added > 0)
    .map((t) => `${counts[t].added} ${LABELS[t][counts[t].added === 1 ? 0 : 1]}`);
  return added.length ? `Added ${added.join(", ")}.` : "Nothing new was added.";
}

/** The notice shown on the profile page, in plain words. */
export function summarizeImport(counts: Record<ImportTable, ImportCount>, awaitingApproval: number): string {
  const skipped = (Object.keys(counts) as ImportTable[]).reduce((n, t) => n + counts[t].skipped, 0);
  const parts = [describeCounts(counts)];
  if (counts.suppression.added) {
    parts.push("Everyone already contacted or asking not to be is on your exclusion list, so nobody here will contact them.");
  }
  if (awaitingApproval) {
    parts.push(
      `${awaitingApproval} imported ${awaitingApproval === 1 ? "item needs" : "items need"} your approval before anything uses them: strategies, pitches and openers arrive unapproved.`,
    );
  }
  if (skipped) parts.push(`${skipped} ${skipped === 1 ? "item was" : "items were"} already here or could not be used, and ${skipped === 1 ? "was" : "were"} skipped.`);
  parts.push("Prospects, campaigns, conversations and team members are never imported.");
  return parts.join(" ");
}
