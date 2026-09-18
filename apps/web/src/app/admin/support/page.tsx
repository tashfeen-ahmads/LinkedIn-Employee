import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, daysUntil } from "@/lib/admin";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
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

/**
 * The support queue: everything on the platform that a person needs to look at.
 *
 * Built from the states that stop a workspace working rather than from a ticket
 * system, because nobody files a ticket for "my account has been restricted for
 * three days and I assumed that was normal". The list being empty is the point.
 */
export default async function AdminSupportPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: accounts }, { data: workspaces }, { data: failures }, { data: tickets }] = await Promise.all([
    supabase
      .from("linkedin_accounts")
      .select("id, workspace_id, user_id, status, status_detail, display_name, connected_at, first_action_at")
      .neq("status", "active"),
    supabase.from("workspaces").select("id, name, plan, trial_ends_at, subscription_status"),
    // An agent call that errored is the clearest signal something is wrong that
    // the customer cannot see and would not know to report.
    supabase
      .from("llm_calls")
      .select("id, workspace_id, agent, model, error, created_at")
      .not("error", "is", null)
      .order("created_at", { ascending: false })
      .limit(25),
    // Somebody typed these. Everything else on this page is inferred from a
    // state; a ticket is a person asking, and it is read first.
    supabase
      .from("support_tickets")
      .select("id, workspace_id, subject, body, status, answer, context, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const names = new Map((workspaces ?? []).map((w) => [w.id, w.name]));

  const expiring = (workspaces ?? [])
    .filter((w) => w.plan === "trial" && w.trial_ends_at)
    .map((w) => ({ ...w, days: daysUntil(w.trial_ends_at) }))
    .filter((w) => w.days !== null && w.days <= 3)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const open = (tickets ?? []).filter((t) => t.status === "open");
  const answered = (tickets ?? []).filter((t) => t.status !== "open");
  const nothing = !accounts?.length && !failures?.length && !expiring.length && !open.length;

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <div className="page-head">
        <h1>Needs attention</h1>
        <p className="muted small">
          States that stop a workspace working. Nobody reports these, because from the inside they
          look like the product being quiet.
        </p>
      </div>

      {nothing ? (
        <div className="notice positive">
          <p>
            Nothing needs attention. No ticket is open, every connected account is healthy, and no
            agent call has failed.
          </p>
        </div>
      ) : null}

      {open.length ? (
        <section className="stack-3">
          <h2>Open tickets</h2>
          <p className="small muted">
            Each one carries what the product believed at the moment it was raised, so the first
            question an operator would ask is already answered.
          </p>
          {open.map((ticket) => (
            <article key={ticket.id} className="card stack-3">
              <div className="between">
                <strong>{ticket.subject}</strong>
                <Link className="small" href={`/admin/workspaces/${ticket.workspace_id}`}>
                  {names.get(ticket.workspace_id) ?? "—"}
                </Link>
              </div>
              <p className="small">{ticket.body}</p>
              <ul className="tiny subtle inline-list">
                {describeTicketContext(ticket.context).map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              <form action={answerTicket} className="stack-2">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <label className="field">
                  <span className="sr-only">Answer</span>
                  <textarea name="answer" rows={3} placeholder="What you found and what you did." />
                </label>
                <div className="row">
                  <label className="field">
                    <span className="tiny">Then</span>
                    <select name="status" defaultValue="answered">
                      <option value="answered">mark answered</option>
                      <option value="closed">close it</option>
                    </select>
                  </label>
                  <SubmitButton pendingLabel="Sending…">Answer</SubmitButton>
                </div>
              </form>
            </article>
          ))}
        </section>
      ) : null}

      {answered.length ? (
        <section className="card">
          <h2>Answered</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Raised</th>
                  <th>Workspace</th>
                  <th>Subject</th>
                  <th>Answer</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {answered.map((t) => (
                  <tr key={t.id}>
                    <td className="small subtle">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/admin/workspaces/${t.workspace_id}`}>
                        {names.get(t.workspace_id) ?? "—"}
                      </Link>
                    </td>
                    <td className="small">{t.subject}</td>
                    <td className="small muted">{t.answer ?? "—"}</td>
                    <td>
                      <span className="pill tiny positive">{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {accounts?.length ? (
        <section className="card">
          <h2>LinkedIn accounts not sending</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Connected</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/admin/workspaces/${a.workspace_id}`}>
                        {names.get(a.workspace_id) ?? "—"}
                      </Link>
                    </td>
                    <td className="small">{a.display_name ?? "—"}</td>
                    <td>
                      <span className={`pill tiny ${a.status === "restricted" ? "danger" : "warning"}`}>
                        {a.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="small muted">{a.status_detail ?? "—"}</td>
                    <td className="small subtle">
                      {a.connected_at ? new Date(a.connected_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {expiring.length ? (
        <section className="card">
          <h2>Trials ending</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th className="num">Days left</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link href={`/admin/workspaces/${w.id}`}>{w.name}</Link>
                    </td>
                    <td className="num">
                      {(w.days ?? 0) < 0 ? `expired ${-(w.days ?? 0)}d ago` : w.days}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {failures?.length ? (
        <section className="card">
          <h2>Failed agent calls</h2>
          <p className="small muted">
            The most recent 25. A refusal or a schema failure here means a draft that never appeared.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Workspace</th>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td className="small subtle">{new Date(f.created_at).toLocaleString()}</td>
                    <td>
                      {/* Nullable: a call can fail before it has a workspace to
                          charge itself to. */}
                      {f.workspace_id ? (
                        <Link href={`/admin/workspaces/${f.workspace_id}`}>
                          {names.get(f.workspace_id) ?? "—"}
                        </Link>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td className="small">{f.agent}</td>
                    <td className="small mono">{f.model}</td>
                    <td className="small muted">{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
