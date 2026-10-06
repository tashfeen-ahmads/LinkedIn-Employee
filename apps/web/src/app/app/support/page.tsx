import { revalidatePath } from "next/cache";
import { Empty, PageHeader, Section } from "@/components/page";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { readSetupState } from "@/lib/setup-state";
import { BOOT_BEAT, BRAND, PACING_LOOP, PACING_STALE_MS } from "@le/shared";

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

  const { data: inserted, error: insertError } = await supabase.from("support_tickets").insert({
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
  }).select("id").single();
  if (insertError || !inserted) {
    redirect(errorQuery("/app/support", "That did not send. Please try again in a moment."));
  }

  // Handed to the assistant now rather than at the next sweep. A failure here
  // costs only speed: the hourly sweep answers anything this missed.
  await callWorker("/jobs/support-ticket", {
    userId: session.userId,
    workspaceId: session.workspaceId,
    ticketId: inserted.id,
  });

  revalidatePath("/app/support");
  redirect(
    noticeQuery(
      "/app/support",
      "Sent. You will usually have an answer on this page within a few minutes.",
    ),
  );
}

/**
 * "Still stuck": the customer reopens their own ticket and says what is still
 * wrong. The function keeps their original words and refuses another
 * workspace's ticket; a reopened ticket is always answered by a person.
 */
async function stillStuck(formData: FormData) {
  "use server";
  const ticketId = String(formData.get("ticketId") ?? "");
  const followup = String(formData.get("followup") ?? "").trim();
  if (!ticketId || !followup) {
    redirect(errorQuery("/app/support", "Say what is still not working, so whoever picks it up starts from there."));
  }
  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_support_ticket", { p_ticket_id: ticketId, p_followup: followup });
  if (error) redirect(errorQuery("/app/support", "That did not send. Please try again in a moment."));
  await callWorker("/jobs/support-ticket", { userId: session.userId, workspaceId: session.workspaceId, ticketId });
  revalidatePath("/app/support");
  redirect(noticeQuery("/app/support", "Reopened. A person from our team will pick this one up."));
}

export default async function SupportPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("id, subject, body, status, answer, answered_by, answered_at, created_at, reopened_at, followup")
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

      <Section title="Your tickets">
        {tickets?.length ? (
          <div className="stack-3">
            {tickets.map((ticket) => (
              <article key={ticket.id} className="card">
                <div className="between">
                  <strong>{ticket.subject}</strong>
                  <span className={`pill ${ticket.status === "open" ? "" : "positive"}`}>{ticket.status}</span>
                </div>
                <p className="small muted">{ticket.body}</p>
                {ticket.reopened_at ? (
                  <p className="tiny subtle">
                    You said this did not help: &ldquo;{ticket.followup}&rdquo; A person from our team is on it.
                  </p>
                ) : ticket.answer ? (
                  <>
                    <p className="small panel">{ticket.answer}</p>
                    <p className="tiny subtle">
                      {ticket.answered_by === "agent" ? `Answered by the ${BRAND.name} assistant` : "Answered by our team"}
                      {ticket.answered_at ? `, ${new Date(ticket.answered_at).toLocaleString()}` : ""}.
                    </p>
                    {ticket.status !== "open" ? (
                      <details>
                        <summary className="small">Still stuck?</summary>
                        <form action={stillStuck} className="stack-2">
                          <input type="hidden" name="ticketId" value={ticket.id} />
                          <label className="field">
                            <span className="small">What is still not working?</span>
                            <textarea name="followup" rows={3} maxLength={4000} />
                          </label>
                          <SubmitButton pendingLabel="Sending…">Send to a person</SubmitButton>
                        </form>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className="tiny subtle">
                    Raised {new Date(ticket.created_at).toLocaleString()}. No answer yet — usually within a few minutes.
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty title="Nothing raised yet.">
            A ticket carries what the product could see at the moment you raised it — which step you
            are on, whether LinkedIn is connected, whether the sending loop has run — so you do not
            have to go and check first.
          </Empty>
        )}
      </Section>
    </>
  );
}
