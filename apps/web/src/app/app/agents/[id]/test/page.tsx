import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

/**
 * What this agent would actually write to somebody.
 *
 * The reason an agent is worth configuring at all. Until now a rep changed a
 * prompt, launched a campaign and found out from the reply — or from silence,
 * which is the same finding out, more slowly, after the invitations have been
 * spent from a capped daily allowance.
 *
 * It runs the real writer against a real prospect from this workspace. Both
 * halves matter. A second implementation for the test area would drift from the
 * one that sends, and a made-up prospect with a tidy company name answers an
 * easier question than the actual list does — the whole point is to find the
 * row where `{{company}}` resolves to nothing.
 *
 * Nothing here can send.
 */

async function runTest(formData: FormData) {
  "use server";
  const session = await requireSession();
  const agentId = String(formData.get("agent") ?? "");
  const here = `/app/agents/${agentId}/test`;

  const prospectId = String(formData.get("prospect") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  if (!prospectId && !firstName) {
    redirect(errorQuery(here, "Pick a prospect, or type a first name to test against."));
  }

  const result = await callWorker<{
    ok: boolean;
    inviteNote: string | null;
    grounding: string[];
    fieldsUsed: string[];
    fieldsMissing: string[];
    model: string | null;
    reason: string | null;
  }>(
    "/jobs/agent-test",
    {
      workspaceId: session.workspaceId,
      userId: session.userId,
      agentId,
      ...(prospectId
        ? { prospectId }
        : { subject: { firstName, company: company || null, title: title || null } }),
    },
    // A model runs on the request thread here, as it does for the pitch
    // writer. Ten seconds reports a working agent as a broken service.
    90_000,
  );

  // Two different failures, said differently. The first is this deployment not
  // reaching its own worker; the second is the agent answering that it cannot
  // write yet, which is a correct answer and the single most useful sentence a
  // rep can be shown — it used to go to a log on a host they cannot reach.
  if (!result.ok) redirect(errorQuery(here, result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery(here, result.data.reason ?? "The agent could not write anything."));
  }

  // Said out loud, and the missing fields said first. A run that quietly
  // appends a row leaves the rep scrolling to find out whether anything
  // happened — and the placeholder nothing could fill is the whole reason to
  // look, so it belongs in the sentence rather than further down the page.
  const missing = result.data?.fieldsMissing ?? [];
  redirect(
    noticeQuery(
      here,
      missing.length
        ? `Written. Nothing filled ${missing.map((f) => `{{${f}}}`).join(", ")} for this person.`
        : "Written. Every merge field resolved for this person.",
    ),
  );
}

export default async function AgentTestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<NoticeParams>;
}) {
  const { id } = await params;
  const notice = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, model")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!agent) notFound();

  const [{ data: prospects }, { data: runs }] = await Promise.all([
    supabase
      .from("prospects")
      .select("id, first_name, last_name, company, title")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("agent_test_runs")
      .select("id, subject, invite_note, fields_used, fields_missing, model, error, created_at")
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={agent.name}
        title="Test this agent"
        lede="Runs the same writer a campaign runs, against a real person from your list. Nothing here is sent."
        actions={
          <Link className="btn secondary" href={`/app/agents/${id}`}>
            Back to the agent
          </Link>
        }
      />

      <PageNotice error={notice.error} notice={notice.notice} />

      <Section
        id="run"
        title="Write a connection note"
        description="Pick somebody already on your list — that is where an unfillable merge field shows up."
      >
        <form action={runTest} className="stack">
          <input type="hidden" name="agent" value={id} />
          <label className="field">
            <span>A prospect you already have</span>
            <select name="prospect" defaultValue="">
              <option value="">Someone made up instead…</option>
              {(prospects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {[p.first_name, p.last_name].filter(Boolean).join(" ")}
                  {p.company ? ` — ${p.company}` : ""}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="field">
            <legend className="small muted">Or type one in</legend>
            <label className="field">
              <span>First name</span>
              <input name="first_name" maxLength={80} />
            </label>
            <label className="field">
              <span>Company</span>
              <input name="company" maxLength={120} />
            </label>
            <label className="field">
              <span>Title</span>
              <input name="title" maxLength={160} />
            </label>
          </fieldset>

          <SubmitButton pendingLabel="Writing…">Run the agent</SubmitButton>
        </form>
      </Section>

      <Section
        id="runs"
        title="What it wrote"
        description="Kept, because the question on the second day is whether a prompt change made this better or worse."
      >
        {(runs ?? []).length === 0 ? (
          <Empty title="Nothing tested yet">
            Run it against one of your own prospects and read what a stranger would receive.
          </Empty>
        ) : (
          <ul className="list">
            {(runs ?? []).map((run) => {
              const subject = (run.subject ?? {}) as { firstName?: string; company?: string };
              const missing = Array.isArray(run.fields_missing) ? (run.fields_missing as string[]) : [];
              return (
                <li key={run.id} className="card">
                  <p className="small muted">
                    {subject.firstName ?? "someone"}
                    {subject.company ? ` at ${subject.company}` : ""} · {run.model ?? "no model"} ·{" "}
                    {run.created_at}
                  </p>
                  {run.error ? (
                    <p className="warn">{run.error}</p>
                  ) : (
                    <p className="prose">{run.invite_note}</p>
                  )}
                  {/* Reported rather than hidden, exactly as empty grounding is.
                      A placeholder the data cannot fill is the one thing this
                      screen exists to catch before a prospect does. */}
                  {missing.length > 0 ? (
                    <p className="small warn">
                      Nothing to fill {missing.map((f) => `{{${f}}}`).join(", ")} for this person.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
