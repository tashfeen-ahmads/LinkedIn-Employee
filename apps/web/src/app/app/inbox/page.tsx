import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Empty, PageHeader } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery } from "@/lib/worker";
import { redirect } from "next/navigation";
import { PageNotice, type NoticeParams } from "@/components/page-notice";

/**
 * Everything waiting on a person.
 *
 * Driven by the conversation, not by the draft. A conversation can be held for
 * a human with no draft at all — the Reply Agent could not write one, or the
 * calendar refused a booking — and while this page listed drafts, those were
 * invisible: a warm reply that the product itself decided needed attention,
 * that nobody was ever shown.
 */

/** No prompt wrote this one; recording a version would be a lie. */
const MANUAL_PROMPT_VERSION = "manual";

async function approveDraft(formData: FormData) {
  "use server";
  const draftId = String(formData.get("draftId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!draftId || !body) return;

  const session = await requireSession();
  const supabase = await createClient();

  // The edited body is what gets sent; the worker reads the row, not the form.
  await supabase
    .from("reply_drafts")
    .update({ body, status: "approved", resolved_by: session.userId, resolved_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("workspace_id", session.workspaceId);

  // The draft is approved in the database either way, and the worker's
  // maintenance sweep re-enqueues approved drafts — so a failure here delays the
  // send rather than losing it. Said plainly, because "approved" and "sent" are
  // not the same thing and the person who clicked is entitled to know which
  // happened.
  const queued = await callWorker("/jobs/send-reply", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    draftId,
  });
  if (!queued.ok) {
    redirect(errorQuery("/app/inbox", `Approved, but sending could not be confirmed: ${queued.error} It will be retried automatically.`));
  }

  revalidatePath("/app/inbox");
}

/** A reply a person wrote themselves, for a conversation with no draft. */
async function sendManualReply(formData: FormData) {
  "use server";
  const conversationId = String(formData.get("conversationId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!conversationId || !body) return;

  const session = await requireSession();
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("reply_drafts")
    .insert({
      workspace_id: session.workspaceId,
      conversation_id: conversationId,
      body,
      prompt_version: MANUAL_PROMPT_VERSION,
      status: "approved",
      resolved_by: session.userId,
      resolved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (!draft) return;

  // Sent through the same path as everything else, so it still passes the rate
  // limiter and lands in the message history. Rule 1 in CLAUDE.md.
  const queued = await callWorker("/jobs/send-reply", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    draftId: draft.id,
  });
  if (!queued.ok) {
    redirect(errorQuery("/app/inbox", `Saved, but sending could not be confirmed: ${queued.error} It will be retried automatically.`));
  }

  revalidatePath("/app/inbox");
}

async function dismissDraft(formData: FormData) {
  "use server";
  const draftId = String(formData.get("draftId"));
  const conversationId = String(formData.get("conversationId"));
  const session = await requireSession();
  const supabase = await createClient();

  if (draftId) {
    await supabase
      .from("reply_drafts")
      .update({ status: "dismissed", resolved_by: session.userId, resolved_at: new Date().toISOString() })
      .eq("id", draftId)
      .eq("workspace_id", session.workspaceId);
  }
  await clearConversationHold(conversationId, session.workspaceId, "reply");

  revalidatePath("/app/inbox");
}

async function markBooked(formData: FormData) {
  "use server";
  const conversationId = String(formData.get("conversationId"));
  const session = await requireSession();
  await clearConversationHold(conversationId, session.workspaceId, "booking");
  revalidatePath("/app/inbox");
}

/**
 * Clears one kind of hold. Scoped by kind for the same reason the worker's is:
 * dismissing a draft says nothing about whether a meeting reached a diary.
 */
async function clearConversationHold(conversationId: string, workspaceId: string, kind: "reply" | "booking") {
  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ needs_human: false, needs_human_reason: null, needs_human_kind: null })
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .eq("needs_human_kind", kind);
}

/**
 * Which slice of the funnel the page is showing.
 *
 * "Waiting" is the default because it is the only one that needs a decision,
 * but it was also the only one that existed — and a rep who has messaged forty
 * people and been shown none of them cannot tell a quiet week from a broken
 * product. Every other stage is read-only history.
 */
const STAGES = [
  { key: "waiting", label: "Waiting on you" },
  { key: "invited", label: "Invited" },
  { key: "accepted", label: "Accepted" },
  { key: "messaged", label: "Messaged" },
  { key: "replied", label: "Replied" },
  { key: "booked", label: "Meeting booked" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

/** Where one prospect has actually got to. */
function stageOf(status: string): Exclude<StageKey, "waiting"> | null {
  if (status === "meeting_booked") return "booked";
  if (status === "replied" || status === "positive") return "replied";
  if (status.startsWith("messaged")) return "messaged";
  if (status === "accepted") return "accepted";
  if (status === "invited") return "invited";
  // queued, closed, failed and opted_out are not stages somebody reached.
  return null;
}

function nameOf(p: { first_name?: string | null; last_name?: string | null } | undefined): string {
  return `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Prospect";
}

function whenOf(row: { invited_at?: string | null; accepted_at?: string | null; replied_at?: string | null }): string | null {
  return row.replied_at ?? row.accepted_at ?? row.invited_at ?? null;
}

export default async function InboxPage({
  searchParams,
}: {
  // NoticeParams is itself a Promise, so wrapping it again made `await`
  // unwrap straight past `stage`. Declared flat instead.
  searchParams: Promise<{ error?: string; notice?: string; stage?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const stage: StageKey = (STAGES.find((s) => s.key === params.stage)?.key ?? "waiting") as StageKey;

  const [{ data: held }, { data: drafts }, { data: funnelRows }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, prospect_id, needs_human_reason, needs_human_kind, last_message_at")
      .eq("workspace_id", session.workspaceId)
      .eq("needs_human", true)
      .order("last_message_at", { ascending: true })
      .limit(100),
    supabase
      .from("reply_drafts")
      .select("id, conversation_id, body, proposes_meeting, unanswered_questions, created_at")
      .eq("workspace_id", session.workspaceId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100),
    // Everyone this workspace has actually contacted. `campaign_prospects` is
    // the record rather than `conversations`, because an invitation that has
    // not been accepted has no conversation at all — and those are most of the
    // people a rep wants to see.
    supabase
      .from("campaign_prospects")
      .select("id, prospect_id, campaign_id, status, invited_at, accepted_at, replied_at")
      .eq("workspace_id", session.workspaceId)
      .not("invited_at", "is", null)
      .order("invited_at", { ascending: false })
      .limit(300),
  ]);

  const draftByConversation = new Map((drafts ?? []).map((d) => [d.conversation_id, d]));
  const conversationIds = [
    ...new Set([...(held ?? []).map((c) => c.id), ...(drafts ?? []).map((d) => d.conversation_id)]),
  ];

  const heldById = new Map((held ?? []).map((c) => [c.id, c]));
  const [{ data: conversations }, { data: messages }] = await Promise.all([
    conversationIds.length
      ? supabase.from("conversations").select("id, prospect_id").in("id", conversationIds)
      : Promise.resolve({ data: [] as Array<{ id: string; prospect_id: string }> }),
    conversationIds.length
      ? supabase
          .from("messages")
          .select("conversation_id, direction, body, created_at")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Array<{ conversation_id: string; direction: string; body: string; created_at: string }> }),
  ]);

  // One fetch for every person named anywhere on the page.
  const prospectIds = [
    ...new Set([
      ...(conversations ?? []).map((c) => c.prospect_id),
      ...(funnelRows ?? []).map((r) => r.prospect_id),
    ]),
  ];
  const { data: prospects } = prospectIds.length
    ? await supabase
        .from("prospects")
        .select("id, first_name, last_name, title, company, linkedin_url")
        .in("id", prospectIds)
    : { data: [] as Array<Record<string, string | null>> };

  const prospectById = new Map((prospects ?? []).map((p) => [p.id as string, p]));
  const prospectByConversation = new Map(
    (conversations ?? []).map((c) => [c.id, prospectById.get(c.prospect_id)]),
  );

  const counts = STAGES.reduce<Record<string, number>>((acc, s) => {
    acc[s.key] =
      s.key === "waiting"
        ? conversationIds.length
        : (funnelRows ?? []).filter((r) => stageOf(r.status) === s.key).length;
    return acc;
  }, {});

  const listed = (funnelRows ?? []).filter((r) => stageOf(r.status) === stage);

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <PageHeader
        title="Inbox"
        lede="Everyone this workspace has written to, and what happened next. Anything the Reply Agent will not answer on its own waits under “Waiting on you”."
      />

      {/* One row of stages, each carrying its own count. A stage with nobody in
          it still shows, because "zero replied" is an answer and a missing tab
          is not. */}
      <nav className="cluster" aria-label="Funnel stage">
        {STAGES.map((s) => (
          <Link
            key={s.key}
            href={s.key === "waiting" ? "/app/inbox" : `/app/inbox?stage=${s.key}`}
            className={`pill ${s.key === stage ? "accent" : ""}`}
            aria-current={s.key === stage ? "page" : undefined}
          >
            {s.label} · {counts[s.key] ?? 0}
          </Link>
        ))}
      </nav>

      {stage === "waiting" ? (
        conversationIds.length === 0 ? (
          <Empty title="Nothing is waiting for you.">
            Anything the Reply Agent will not answer on its own — a price, a legal question, anything
            negative, or simply low confidence — is held here rather than guessed at. Use the stages
            above to see everyone you have written to.
          </Empty>
        ) : (
          <div className="grid">
        {conversationIds.map((conversationId) => {
          const hold = heldById.get(conversationId);
          const draft = draftByConversation.get(conversationId);
          const prospect = prospectByConversation.get(conversationId);
          const thread = (messages ?? []).filter((m) => m.conversation_id === conversationId);
          const questions = Array.isArray(draft?.unanswered_questions)
            ? (draft.unanswered_questions as string[])
            : [];
          const booking = hold?.needs_human_kind === "booking";

          return (
            <article key={conversationId} className="card">
              <header className="between">
                <div>
                  <strong>
                    {prospect
                      ? `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect"
                      : "Prospect"}
                  </strong>
                  <p className="small muted">
                    {[prospect?.title, prospect?.company].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="cluster top">
                  {hold?.needs_human_reason ? (
                    <span className={`pill ${booking ? "danger" : "warning"}`}>{hold.needs_human_reason}</span>
                  ) : null}
                  {draft?.proposes_meeting ? <span className="pill accent">Proposes a meeting</span> : null}
                </div>
              </header>

              <div className="panel scroll"
              >
                {thread.map((message, index) => (
                  <p key={index} className="small">
                    <span className="muted">{message.direction === "outbound" ? "You: " : "Them: "}</span>
                    {message.body}
                  </p>
                ))}
              </div>

              {questions.length ? (
                <div className="notice warning">
                  The agent could not answer: {questions.join("; ")}
                </div>
              ) : null}

              {booking ? (
                <>
                  <p className="small">
                    They accepted a time and the calendar write failed, so this meeting is in nobody&apos;s
                    diary. Put it in yours, then mark it done.
                  </p>
                  <form action={markBooked}>
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <button className="btn" type="submit">
                      I have booked it
                    </button>
                  </form>
                </>
              ) : draft ? (
                <>
                  <form action={approveDraft}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <label className="field">
                      <span>Reply</span>
                      <textarea name="body" rows={4} defaultValue={draft.body} />
                    </label>
                    <button className="btn" type="submit">
                      Send
                    </button>
                  </form>
                  <form action={dismissDraft}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <button className="btn secondary small" type="submit">
                      Dismiss, I will handle it on LinkedIn
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="small muted">
                    The agent did not write a reply for this one. Yours goes out through the same
                    account and the same daily limits.
                  </p>
                  <form action={sendManualReply}>
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <label className="field">
                      <span>Your reply</span>
                      <textarea name="body" rows={4} required />
                    </label>
                    <button className="btn" type="submit">
                      Send
                    </button>
                  </form>
                  <form action={dismissDraft}>
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <button className="btn secondary small" type="submit">
                      Dismiss, I will handle it on LinkedIn
                    </button>
                  </form>
                </>
              )}
            </article>
          );
        })}
        </div>
        )
      ) : listed.length === 0 ? (
        <Empty title={`Nobody is at “${STAGES.find((s) => s.key === stage)?.label}” yet.`}>
          This is history, not a queue — nothing here needs a decision from you.
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Company</th>
                <th>Stage</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((row) => {
                const p = prospectById.get(row.prospect_id);
                const when = whenOf(row);
                return (
                  <tr key={row.id}>
                    <td>
                      {p?.linkedin_url ? (
                        <a href={p.linkedin_url as string} target="_blank" rel="noreferrer">
                          {nameOf(p as never)}
                        </a>
                      ) : (
                        nameOf(p as never)
                      )}
                    </td>
                    <td className="muted">{(p?.company as string) || "—"}</td>
                    <td>{STAGES.find((s) => s.key === stageOf(row.status))?.label ?? row.status}</td>
                    <td className="muted">{when ? new Date(when).toLocaleDateString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
