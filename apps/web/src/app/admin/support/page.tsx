import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SUPPORT_CATEGORY_LABEL, type SupportCategory } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago } from "@/lib/admin";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageHeader, Section, Empty } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { Kpi } from "@/components/charts";
import { ControlButton } from "@/components/admin-control";
import { describeTicketContext } from "@/lib/support";

export const dynamic = "force-dynamic";

/**
 * Answering goes through a definer function, not an update: RLS cannot restrict
 * columns, and the customer's own account of what went wrong is the one field
 * in the row that must survive being replied to.
 */
async function answerTicket(formData: FormData) {
  "use server";
  await requirePlatformAdmin();
  const ticketId = String(formData.get("ticketId") ?? "");
  const answer = String(formData.get("answer") ?? "").trim();
  const status = String(formData.get("status") ?? "answered");
  if (!ticketId || !answer) {
    redirect(errorQuery("/admin/support", "An answer with no words in it is not an answer."));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_support_ticket", {
    p_ticket_id: ticketId,
    p_answer: answer,
    p_status: status,
  });
  if (error) {
    // Said rather than swallowed: a reply that silently did not save is a
    // customer waiting on an answer that was written and never sent.
    redirect(errorQuery("/admin/support", `That did not save: ${error.message}`));
  }

  revalidatePath("/admin/support");
  redirect(noticeQuery("/admin/support", "Answered. It is on their Support page now."));
}

function categoryLabel(category: string | null): string | null {
  return category && category in SUPPORT_CATEGORY_LABEL ? SUPPORT_CATEGORY_LABEL[category as SupportCategory] : null;
}

/**
 * The support queue.
 *
 * Every ticket is read by the assistant within minutes of being raised. When it
 * is sure, the question is a how-to and autopilot is on, the answer goes
 * straight to the customer; otherwise its answer waits here, prefilled, with the
 * reason it was held. So the list below is only what genuinely needs a person,
 * and an operator's job is to read a draft rather than write from nothing.
 */
export default async function AdminSupportPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  await requirePlatformAdmin();
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: workspaces }, { data: tickets }, { data: settings }, { data: users }] = await Promise.all([
    supabase.from("workspaces").select("id, name"),
    supabase
      .from("support_tickets")
      .select(
        "id, workspace_id, raised_by, subject, body, status, answer, answered_by, answered_at, context, created_at, category, draft_answer, draft_confidence, draft_reason, drafted_at, reopened_at, followup",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("platform_settings").select("support_autopilot").maybeSingle(),
    supabase.rpc("platform_users"),
  ]);

  const names = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const who = new Map((users ?? []).map((u) => [u.user_id, u.full_name ? `${u.full_name} · ${u.email}` : u.email]));
  const autopilot = settings?.support_autopilot !== false;

  const open = (tickets ?? []).filter((t) => t.status === "open");
  const closed = (tickets ?? []).filter((t) => t.status !== "open");
  const thisWeek = (tickets ?? []).filter((t) => t.created_at >= weekAgo);
  const byAssistant = thisWeek.filter((t) => t.answered_by === "agent").length;
  const byYou = thisWeek.filter((t) => t.answered_by === "operator").length;
  const reopened = thisWeek.filter((t) => t.reopened_at).length;

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <PageHeader
        eyebrow="Operator"
        title="Support"
        lede="The assistant reads every ticket first. What it answered is below; what it was not sure about waits here with its draft."
        actions={<ControlButton op="support-sweep" back="/admin/support" label="Ask the assistant now" pendingLabel="Answering…" />}
      />

      <Section title="This week">
        <div className="kpi-row">
          <Kpi label="Waiting for you" value={String(open.length)} tone={open.length ? "warning" : "neutral"} />
          <Kpi label="Answered by the assistant" value={String(byAssistant)} />
          <Kpi label="Answered by you" value={String(byYou)} />
          <Kpi label="Said it did not help" value={String(reopened)} note="reopened with Still stuck" />
          <Kpi
            label="Autopilot"
            value={autopilot ? "On" : "Off"}
            note={<Link href="/admin/settings">{autopilot ? "confident answers are sent" : "every answer waits for you"}</Link>}
          />
        </div>
      </Section>

      <Section title="Open" description="Each one carries what the product believed when it was raised.">
        {!open.length ? (
          <Empty title="Nothing waiting.">Every ticket has an answer.</Empty>
        ) : (
          <div className="stack-3">
            {open.map((ticket) => {
              const category = categoryLabel(ticket.category);
              return (
                <article key={ticket.id} className="card">
                  <div className="between">
                    <strong>{ticket.subject}</strong>
                    <span className="cluster">
                      {category ? <span className="pill tiny plain">{category}</span> : null}
                      {ticket.reopened_at ? <span className="pill tiny danger">still stuck</span> : null}
                      <span className="tiny subtle">{ago(ticket.created_at)}</span>
                    </span>
                  </div>
                  <p className="tiny subtle">
                    <Link href={`/admin/workspaces/${ticket.workspace_id}`}>{names.get(ticket.workspace_id) ?? "—"}</Link>
                    {ticket.raised_by ? ` · ${who.get(ticket.raised_by) ?? ""}` : ""}
                  </p>
                  <p className="small">{ticket.body}</p>
                  {ticket.reopened_at ? (
                    <div className="panel stack-1">
                      <p className="tiny subtle">We answered:</p>
                      <p className="small muted">{ticket.answer ?? "—"}</p>
                      <p className="tiny subtle">They said it did not help, {ago(ticket.reopened_at)}:</p>
                      <p className="small">{ticket.followup}</p>
                    </div>
                  ) : null}
                  <ul className="tiny subtle inline-list">
                    {describeTicketContext(ticket.context).map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>

                  {ticket.drafted_at ? (
                    <p className="small">
                      <span className="pill tiny warning">held</span>{" "}
                      <span className="muted">
                        {ticket.draft_reason ?? "The assistant held this for you."}
                        {ticket.draft_confidence !== null ? ` Confidence ${Math.round(ticket.draft_confidence * 100)}%.` : ""}
                      </span>
                    </p>
                  ) : (
                    <p className="small muted">The assistant has not looked at this one yet.</p>
                  )}

                  <form action={answerTicket} className="stack-2">
                    <input type="hidden" name="ticketId" value={ticket.id} />
                    <label className="field">
                      <span className="tiny">{ticket.draft_answer ? "The assistant's draft — edit it or send it as it is" : "Answer"}</span>
                      <textarea
                        name="answer"
                        rows={ticket.draft_answer ? 7 : 3}
                        defaultValue={ticket.draft_answer ?? ""}
                        placeholder="What you found and what you did."
                      />
                    </label>
                    <div className="row">
                      <label className="field">
                        <span className="tiny">Then</span>
                        <select name="status" defaultValue="answered">
                          <option value="answered">mark answered</option>
                          <option value="closed">close it</option>
                        </select>
                      </label>
                      <SubmitButton pendingLabel="Sending…">Send answer</SubmitButton>
                    </div>
                  </form>
                  <div className="cluster">
                    <ControlButton
                      op="support-redraft"
                      fields={{ ticketId: ticket.id }}
                      back="/admin/support"
                      label={ticket.drafted_at ? "Draft again" : "Ask the assistant"}
                      pendingLabel="Drafting…"
                      tone="ghost"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Section>

      {closed.length ? (
        <Section title="Answered">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Raised</th>
                  <th>Workspace</th>
                  <th>Subject</th>
                  <th>Answer</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((t) => (
                  <tr key={t.id}>
                    <td className="small subtle">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/admin/workspaces/${t.workspace_id}`}>{names.get(t.workspace_id) ?? "—"}</Link>
                    </td>
                    <td className="small">
                      {t.subject}
                      {categoryLabel(t.category) ? <p className="tiny subtle">{categoryLabel(t.category)}</p> : null}
                    </td>
                    <td className="small muted">{t.answer ?? "—"}</td>
                    <td>
                      <span className={`pill tiny ${t.answered_by === "agent" ? "plain" : "positive"}`}>
                        {t.answered_by === "agent" ? "assistant" : t.answered_by === "operator" ? "you" : t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </>
  );
}
