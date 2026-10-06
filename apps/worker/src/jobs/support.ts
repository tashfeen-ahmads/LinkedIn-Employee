import { draftSupportAnswer } from "@le/agents";
import {
  PACING_LOOP,
  PACING_STALE_MS,
  describeTicketContext,
  supportGate,
  type SupportDraft,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { loadPlatformSettings, outreachPause } from "../platform.js";

export type SupportOutcome = "answered" | "held" | "failed" | "skipped";

/**
 * Answers one support ticket with the assistant, or drafts an answer for a
 * person — `supportGate` decides which.
 *
 * Runs once per ticket: `drafted_at` is stamped whatever happens, so the sweep
 * never pays for the same ticket twice. A ticket the assistant could not answer
 * at all is stamped with the reason and left open for a person, which is where
 * it would have been anyway.
 *
 * Every write is conditional on the ticket still being open and undrafted, so
 * an operator who answers by hand while the model is thinking is never
 * overwritten by the model.
 */
export async function answerSupportTicket(ctx: WorkerContext, ticketId: string, opts: { redraft?: boolean } = {}): Promise<SupportOutcome> {
  const { db } = ctx;
  const { data: ticket } = await db
    .from("support_tickets")
    .select("id, workspace_id, raised_by, subject, body, status, context, answer, followup, reopened_at, drafted_at, created_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket || ticket.status !== "open") return "skipped";
  if (ticket.drafted_at && !opts.redraft) return "skipped";

  const stamp = new Date().toISOString();
  const { settings } = await loadPlatformSettings(db);

  let draft: SupportDraft;
  try {
    draft = await draftSupportAnswer(ctx.agentsFor(ticket.workspace_id), {
      subject: ticket.subject,
      body: ticket.body,
      followup: ticket.followup,
      previousAnswer: ticket.reopened_at ? ticket.answer : null,
      thenFacts: describeTicketContext(ticket.context),
      nowFacts: await workspaceFacts(ctx, ticket.workspace_id, ticket.raised_by),
    });
  } catch (err) {
    const reason = (err as { message?: string })?.message ?? "unknown";
    await db
      .from("support_tickets")
      .update({ drafted_at: stamp, draft_reason: `The assistant could not answer this one: ${reason.slice(0, 300)}` })
      .eq("id", ticket.id)
      .eq("status", "open");
    return "failed";
  }

  const verdict = supportGate({
    autopilot: settings.supportAutopilot,
    reopened: Boolean(ticket.reopened_at),
    ageMs: Date.now() - Date.parse(ticket.created_at),
    draft,
  });

  // Conditional on the ticket still being open — and still undrafted, unless an
  // operator asked for a fresh draft — so a person answering by hand while the
  // model was thinking is never overwritten by the model.
  const write = (fields: Record<string, unknown>) => {
    let q = db
      .from("support_tickets")
      .update(fields as never)
      .eq("id", ticket.id)
      .eq("status", "open");
    if (!opts.redraft) q = q.is("drafted_at", null);
    return q.select("id");
  };

  if (verdict.send) {
    const { data: written } = await write({
        status: "answered",
        answer: draft.answer.trim(),
        answered_by: "agent",
        answered_at: stamp,
        category: draft.category,
        draft_answer: null,
        draft_confidence: draft.confidence,
        draft_reason: null,
        drafted_at: stamp,
    });
    if (!written?.length) return "skipped";
    await recordEvent(db, {
      workspaceId: ticket.workspace_id,
      name: "support.answered",
      subjectType: "support_ticket",
      subjectId: ticket.id,
      payload: { by: "agent", category: draft.category, confidence: draft.confidence },
    }).catch(() => undefined);
    return "answered";
  }

  const { data: held } = await write({
      category: draft.category,
      draft_answer: draft.answer.trim(),
      draft_confidence: draft.confidence,
      draft_reason: verdict.reason,
      drafted_at: stamp,
  });
  if (!held?.length) return "skipped";
  await recordEvent(db, {
    workspaceId: ticket.workspace_id,
    name: "support.held",
    subjectType: "support_ticket",
    subjectId: ticket.id,
    payload: { category: draft.category, confidence: draft.confidence, reason: verdict.reason },
  }).catch(() => undefined);
  return "held";
}

/** Every open ticket the assistant has not looked at yet, oldest first. */
export async function sweepSupportTickets(ctx: WorkerContext, limit = 10): Promise<Record<SupportOutcome, number>> {
  const tally: Record<SupportOutcome, number> = { answered: 0, held: 0, failed: 0, skipped: 0 };
  const { data: open } = await ctx.db
    .from("support_tickets")
    .select("id")
    .eq("status", "open")
    .is("drafted_at", null)
    .order("created_at")
    .limit(limit);
  for (const row of open ?? []) {
    tally[await answerSupportTicket(ctx, row.id)] += 1;
  }
  return tally;
}

/**
 * What the product believes about this workspace right now, as sentences.
 *
 * Counts and states only — never a prospect's name or a message's words
 * (rule 15). The assistant needs to know a campaign is a draft, not who is in it.
 */
export async function workspaceFacts(ctx: WorkerContext, workspaceId: string, userId: string | null): Promise<string[]> {
  const { db } = ctx;
  const [
    { data: business },
    { data: strategies },
    { data: accounts },
    { data: campaigns },
    { data: held },
    { data: pitches },
    { data: hooks },
    { data: pacing },
  ] = await Promise.all([
    db.from("business_profiles").select("id").eq("workspace_id", workspaceId).limit(1),
    db.from("customer_profiles").select("id, approved_at, do_not_pursue").eq("workspace_id", workspaceId),
    db.from("linkedin_accounts").select("user_id, status, invites_paused_until").eq("workspace_id", workspaceId),
    db.from("campaigns").select("id, name, status, launched_at").eq("workspace_id", workspaceId),
    db.from("conversations").select("id, needs_human_kind").eq("workspace_id", workspaceId).eq("needs_human", true),
    db.from("pitches").select("id, approved_at").eq("workspace_id", workspaceId),
    db.from("hooks").select("id, approved_at").eq("workspace_id", workspaceId),
    db.from("worker_heartbeats").select("beat_at").eq("name", PACING_LOOP).maybeSingle(),
  ]);

  const facts: string[] = [];
  facts.push(business?.length ? "They have told us what they sell (business profile exists)." : "They have NOT told us what they sell yet.");

  const pursued = (strategies ?? []).filter((s) => !s.do_not_pursue);
  const approved = pursued.filter((s) => s.approved_at).length;
  facts.push(`Strategies (customer profiles): ${pursued.length} written, ${approved} approved.`);

  const mine = (accounts ?? []).find((a) => a.user_id === userId) ?? (accounts ?? [])[0];
  if (!mine) facts.push("LinkedIn: not connected.");
  else {
    facts.push(`LinkedIn: ${mine.status.replaceAll("_", " ")}.`);
    if (mine.invites_paused_until && Date.parse(mine.invites_paused_until) > Date.now()) {
      facts.push(`LinkedIn is temporarily refusing new invitations from this account until ${mine.invites_paused_until}; follow-ups still go.`);
    }
  }

  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const progress = new Map<string, Record<string, number>>();
  if (campaignIds.length) {
    const { data: rows } = await db
      .from("campaign_prospects")
      .select("campaign_id, status")
      .in("campaign_id", campaignIds)
      .limit(20000);
    for (const row of rows ?? []) {
      const c = progress.get(row.campaign_id) ?? {};
      c[row.status] = (c[row.status] ?? 0) + 1;
      progress.set(row.campaign_id, c);
    }
  }
  if (!campaigns?.length) facts.push("Campaigns: none yet.");
  for (const campaign of campaigns ?? []) {
    const c = progress.get(campaign.id) ?? {};
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    const parts = Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .map(([status, n]) => `${n} ${status.replaceAll("_", " ")}`)
      .join(", ");
    facts.push(
      `Campaign "${campaign.name}": ${campaign.status}${campaign.launched_at ? "" : " (never launched)"}, ${total} people${parts ? ` — ${parts}` : ""}.`,
    );
  }

  const approvedPitches = (pitches ?? []).filter((p) => p.approved_at).length;
  const approvedHooks = (hooks ?? []).filter((h) => h.approved_at).length;
  facts.push(`Approved opener lines: ${approvedHooks}. Approved offer lines: ${approvedPitches}.`);

  const heldCount = (held ?? []).length;
  facts.push(
    heldCount
      ? `Conversations waiting for them in the Inbox: ${heldCount}.`
      : "No conversations are waiting for them in the Inbox.",
  );

  const beatAge = pacing?.beat_at ? Date.now() - Date.parse(pacing.beat_at) : Infinity;
  facts.push(beatAge <= PACING_STALE_MS ? "The sending system is running normally." : "The sending system is NOT running — this is on our side.");
  const paused = await outreachPause(db);
  if (paused) facts.push("Outreach is paused platform-wide by us at the moment — this is on our side, nothing is lost.");

  return facts;
}
