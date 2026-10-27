import { FIRST_STEP_TIMING_LABEL } from "@le/shared";
import { Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { sequenceFor } from "@/components/sequence";
import { SequencePath } from "@/components/sequence-path";
import { CopyPreview } from "@/components/copy-preview";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { loadCampaign, personOf } from "../data";
import { saveAndLaunch, saveCampaign } from "../actions";

/**
 * What a prospect receives after accepting, drawn and then edited.
 *
 * Drawn rather than dragged (rule 52): most arrangements a canvas offers are
 * ones this product refuses to send, and a refusal that arrives after the work
 * is worse than never offering it. The words are the person's to edit; the
 * timings the product owns say why they are not.
 */
export default async function CampaignFollowUpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const { campaign, steps, running, blockers, rows, cta, bookingUrl } = await loadCampaign(id);
  const session = await requireSession();
  const supabase = await createClient();
  // The offer the messages carry, so a preview can read as a person would.
  const { data: pitch } = await supabase
    .from("pitches")
    .select("body")
    .eq("workspace_id", session.workspaceId)
    .not("approved_at", "is", null)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Somebody real on the list, for the previews under each message.
  const sample = rows.map((row) => personOf(row)).find(Boolean) ?? null;
  const link = cta.url ?? (cta.kind === "meeting" ? bookingUrl : null);

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />

      <Section
        framed
        id="sequence"
        title="Sequence"
        description="What each person receives, in order. The locked timings are product rules."
      >
        <SequencePath
          steps={sequenceFor({
            warmUp: Boolean(campaign.warm_up),
            connectionNote: campaign.connection_note,
            steps: steps.map((step) => ({
              step_number: step.step_number,
              delay_days: step.delay_days,
              message: step.message,
            })),
          })}
        />
      </Section>

      <Section
        id="messages"
        title="The messages"
        description={
          "Read each one before it goes. A word in double curly brackets is filled in for each person: their first name, company or job title, your name, your approved offer, or the campaign's link." +
          (running ? " Edits apply to everyone who has not been reached yet." : "")
        }
      >
        <form action={saveCampaign} className="card">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input type="hidden" name="section" value="follow-ups" />
          {steps.length === 0 ? (
            <p className="small muted">This campaign has no follow-up messages.</p>
          ) : (
            steps.map((step) => (
              <label className="field" key={step.id}>
                <span>
                  Follow-up {step.step_number} ·{" "}
                  {/* Step 1 has no previous message — what precedes it is the
                      acceptance, and it is sent inside the hour (rule 43). Saying
                      "0 days after the previous message" described neither. */}
                  {step.step_number === 1
                    ? FIRST_STEP_TIMING_LABEL
                    : `${step.delay_days} ${step.delay_days === 1 ? "day" : "days"} after the previous message`}
                </span>
                <textarea name={`step-${step.id}`} rows={3} defaultValue={step.message} />
                {/* How it reads, so nobody has to picture what the
                    curly-bracket words turn into. Saved text, not live. */}
                <span className="hint">
                  {sample?.first_name ? `How ${sample.first_name} reads it: ` : "How it reads: "}
                  <CopyPreview
                    message={step.message}
                    person={sample}
                    pitch={pitch?.body ?? null}
                    link={link}
                    linkLabel={cta.kind === "meeting" ? "a personal link to book a call" : "your link"}
                  />
                </span>
              </label>
            ))
          )}
          <div className="cluster">
            <SubmitButton className="btn secondary" pendingLabel="Saving…">
              Save
            </SubmitButton>
            {/*
              Launch from here saves what is on screen first. Launch used to be
              a form with none of these fields in it, and edits made before
              pressing it were silently discarded.
            */}
            {running ? null : (
              <SubmitButton
                className="btn"
                pendingLabel="Launching…"
                formAction={saveAndLaunch}
                disabled={blockers.length > 0}
                title={blockers.length > 0 ? "Fix what Overview lists under Not ready to launch first" : undefined}
              >
                Save and launch
              </SubmitButton>
            )}
          </div>
        </form>
      </Section>
    </>
  );
}
