import { revalidatePath } from "next/cache";
import { PageHeader } from "@/components/page";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { readSetupState } from "@/lib/setup-state";
import { BOOT_BEAT, PACING_LOOP, PACING_STALE_MS } from "@le/shared";

/**
 * Somewhere to say "this is broken" without leaving the product.
 *
 * Every failure this deployment hit was reported by somebody typing into a chat
 * window and pasting a screenshot, and every one needed the same three facts:
 * which workspace, what they were doing, and what the product believed at that
 * moment. The first two were always in the message somewhere. The third never
 * was — and the person raising the ticket does not know which of those facts
 * matters and should not have to work it out.
 */
async function raiseTicket(formData: FormData) {
  "use server";
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!subject || !body) {
    redirect(errorQuery("/app/support", "A subject and a description, please — both get read."));
  }

  const session = await requireSession();
  const supabase = await createClient();

  // Gathered rather than asked for. Somebody reporting "the button does
  // nothing" cannot be expected to know that the answer is a stale heartbeat,
  // and asking them to check first is asking them to do the diagnosis.
  const [{ next }, { data: account }, { data: beats }] = await Promise.all([
    readSetupState(supabase, session.workspaceId),
    supabase
      .from("linkedin_accounts")
      .select("status, status_detail")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.from("worker_heartbeats").select("name, beat_at, detail").in("name", [PACING_LOOP, BOOT_BEAT]),
  ]);

  const pacing = (beats ?? []).find((b) => b.name === PACING_LOOP);
  const boot = (beats ?? []).find((b) => b.name === BOOT_BEAT);
  const beatAge = pacing?.beat_at ? Date.now() - new Date(pacing.beat_at).getTime() : null;

  await supabase.from("support_tickets").insert({
    workspace_id: session.workspaceId,
    raised_by: session.userId,
    subject,
    body,
    context: {
      // The three questions an operator asks first, answered before they ask.
      stuckOn: next?.key ?? null,
      stuckOnLabel: next?.label ?? "nothing — setup is complete",
      linkedInStatus: account?.status ?? "not connected",
      linkedInDetail: account?.status_detail ?? null,
      sendingLoopRunning: beatAge !== null && beatAge <= PACING_STALE_MS,
      pacingBeatAt: pacing?.beat_at ?? null,
      workerBootAt: boot?.beat_at ?? null,
      workerBuild: (boot?.detail as { commit?: string } | null)?.commit ?? null,
      raisedAt: new Date().toISOString(),
    } as never,
  });

  revalidatePath("/app/support");
  redirect(
    noticeQuery(
      "/app/support",
      "Sent. It includes what the product thought was true just now, so nobody has to ask you to check things.",
    ),
  );
}

export default async function SupportPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("id, subject, body, status, answer, answered_at, created_at")
    .eq("workspace_id", session.workspaceId)
    .order("created_at", { ascending: false })
    .limit(25);

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <PageHeader
        eyebrow="Help"
        title="Support"
        lede={
          <>
          Tell us what is not working. Every ticket carries what the product believed at the moment you
          raised it — which step you are on, whether LinkedIn is connected, whether the sending loop is
          running — so you do not have to go and check any of that first.
          </>
        }
      />

      <section className="card">
        <form action={raiseTicket}>
          <label className="field">
            <span>What is wrong, in a line</span>
            <input type="text" name="subject" maxLength={140} placeholder="Find prospects does nothing" />
          </label>
          <label className="field">
            <span>What you did and what happened</span>
            <textarea
              name="body"
              rows={5}
              placeholder="I approved a customer profile, pressed Find prospects, and the Prospects page is still empty ten minutes later."
            />
          </label>
          <SubmitButton pendingLabel="Sending…">Raise a ticket</SubmitButton>
        </form>
      </section>

      <section className="stack-4">
        <h2>Your tickets</h2>
        {tickets?.length ? (
          <div className="stack-3">
            {tickets.map((ticket) => (
              <article key={ticket.id} className="card">
                <div className="between">
                  <strong>{ticket.subject}</strong>
                  <span className={`pill ${ticket.status === "open" ? "" : "positive"}`}>{ticket.status}</span>
                </div>
                <p className="small muted">{ticket.body}</p>
                {ticket.answer ? (
                  <p className="small panel">{ticket.answer}</p>
                ) : (
                  <p className="tiny subtle">
                    Raised {new Date(ticket.created_at).toLocaleString()}. No answer yet.
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="small muted">Nothing raised yet.</p>
        )}
      </section>
    </>
  );
}
