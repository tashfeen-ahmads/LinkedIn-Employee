import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { loadCampaign } from "../data";
import { deleteCampaign, saveAndLaunch, saveCampaign } from "../actions";

/**
 * The campaign's pace and its fallback note: how many invitations a day, the
 * profile view before each one, and the line anybody without a note of their
 * own receives. And deleting a draft that never reached anybody.
 */
export default async function CampaignSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const { campaign, running, blockers, counts } = await loadCampaign(id);
  const deletable = campaign.status === "draft" && !campaign.launched_at && counts.invited === 0;

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />

      <Section id="pace" title="Pace and standard note">
        <form action={saveCampaign} className="card">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input type="hidden" name="section" value="settings" />
          {/* An unticked box posts nothing, so the form says it carries one. */}
          <input type="hidden" name="warm_up_field" value="1" />

          <label className="field">
            <span>Invitations a day</span>
            <input
              className="input-short"
              type="number"
              name="dailyInviteCap"
              inputMode="numeric"
              min={1}
              max={LINKEDIN_LIMITS.invitesPerDayMax}
              defaultValue={campaign.daily_invite_cap}
            />
            <span className="hint">
              The most this campaign sends in a day. Campaigns on one LinkedIn account share its
              limits, the top is {LINKEDIN_LIMITS.invitesPerDayMax} a day for safety, and a new account
              starts lower whatever this says.
            </span>
          </label>

          <label className="check">
            <input type="checkbox" name="warm_up" defaultChecked={campaign.warm_up} />
            <span>
              Look at each profile a few hours before inviting
              <span className="hint">
                LinkedIn shows people who viewed them, so your invitation arrives from a name they
                have already seen. Views have their own daily allowance and never use up invitations.
              </span>
            </span>
          </label>

          <label className="field">
            <span>Standard connection note</span>
            <textarea
              name="connectionNote"
              rows={3}
              defaultValue={campaign.connection_note}
              maxLength={INVITE_NOTE_MAX_CHARS}
            />
            <span className="hint">
              Up to {INVITE_NOTE_MAX_CHARS} characters. Sent only to people Nora could not write a
              personal note for; everybody else gets their own note, shown on People.
            </span>
          </label>

          <div className="cluster">
            <SubmitButton className={running ? "btn" : "btn secondary"} pendingLabel="Saving…">
              Save
            </SubmitButton>
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

      <Section
        id="delete"
        title="Delete this campaign"
        description={
          deletable
            ? "Nobody on it has been invited, so nothing is lost but the draft. The people on it stay in your prospect list and can go on another campaign."
            : "Once anybody on a campaign has been invited, it is kept: its list is the record of who was contacted and with which words. Pause it instead, from the top of this page."
        }
      >
        {deletable ? (
          <form action={deleteCampaign}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <ConfirmButton confirmLabel="Delete for good" pendingLabel="Deleting…">
              Delete draft
            </ConfirmButton>
          </form>
        ) : null}
      </Section>
    </>
  );
}
