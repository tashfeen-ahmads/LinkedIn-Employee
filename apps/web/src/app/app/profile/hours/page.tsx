import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { describeWorkingHours } from "@le/shared";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/page";
import { TimezoneSelect } from "@/components/timezone-select";
import { carryTimezoneToAvailability } from "@/lib/availability";
import { mergeStash, readOnboardingStash, stashedAccountAnswers } from "@/lib/onboarding-stash";
import { DAYS, HOURS, PROFILE_SECTIONS, hourLabel, isKnownTimezone, readWorkingHours } from "../sections";

const HERE = PROFILE_SECTIONS.hours;

/**
 * When the account may act, in the rep's own timezone.
 *
 * Every validation the one-page form carried is still here, because none of
 * them was ceremony: an inverted or empty window would either send nothing or
 * send at three in the morning, and a timezone this runtime cannot evaluate
 * falls back to UTC in silence — which is how this deployment came to invite
 * New Yorkers at 4am while its own screen read "8 to 18".
 */
async function saveHours(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const days = [1, 2, 3, 4, 5, 6, 0].filter((day) => formData.get(`day-${day}`) === "on");
  const timezone = String(formData.get("timezone") ?? "").trim();

  // A window that is empty or inverted is not a setting anybody means to
  // choose, so it is refused rather than written — and said out loud, because
  // silently keeping the old hours after somebody edited them is the same class
  // of lie as saving them wrong.
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end || days.length === 0) {
    redirect(
      errorQuery(
        HERE,
        "Those sending hours cannot be used: the day has to start before it ends, and at least one day has to be ticked.",
      ),
    );
  }
  if (!isKnownTimezone(timezone)) {
    redirect(errorQuery(HERE, "Pick your timezone from the list. That one is not a zone we can read."));
  }

  const { data: before } = await supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle();
  const { error: profileError } = await supabase.from("profiles").update({ timezone }).eq("id", session.userId);
  // Meeting hours are read in a zone too, and Availability falls back to this
  // one (rule 65). A move to a new zone that left the meeting row behind
  // offered prospects times in the old one, so it is carried across.
  if (!profileError && timezone !== before?.timezone) {
    await carryTimezoneToAvailability(supabase, session.workspaceId, session.userId, timezone);
  }

  const accountPatch = { working_hours: { start, end, days } };
  const { data: updatedAccounts } = await supabase
    .from("linkedin_accounts")
    .update(accountPatch as never)
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .select("id");

  /*
   * No account row yet — nobody has pressed Connect — so the update above
   * matched nothing. The hours go where onboarding put them instead: the stash
   * the worker copies onto the row the moment Connect creates it. Merged,
   * because the same row holds the autonomy answer and what Sage was asked to
   * read. Only an owner or admin may write the workspace row, and a refused
   * update matches nothing rather than failing, so that is said, not assumed.
   */
  let accountAnswersKept = true;
  if (!updatedAccounts?.length) {
    const { data: wsStash } = await supabase.from("workspaces").select("onboarding").eq("id", session.workspaceId).maybeSingle();
    const { data: stashed } = await supabase
      .from("workspaces")
      .update({ onboarding: mergeStash(wsStash?.onboarding, stashedAccountAnswers(accountPatch)) as never })
      .eq("id", session.workspaceId)
      .select("id");
    accountAnswersKept = Boolean(stashed?.length);
  }

  revalidatePath("/app/profile", "layout");
  // "Saved." over answers that went nowhere is the bug the stash exists to fix.
  redirect(
    noticeQuery(
      HERE,
      accountAnswersKept
        ? "Saved."
        : "Saved your timezone. Your sending hours can be set once your LinkedIn account is connected.",
    ),
  );
}

export default async function HoursPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const [{ data: account }, { data: me }, { data: ws }] = await Promise.all([
    supabase
      .from("linkedin_accounts")
      .select("working_hours")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    supabase.from("workspaces").select("onboarding").eq("id", session.workspaceId).maybeSingle(),
  ]);
  // What the form shows comes from wherever a save would write it: the account
  // row once one exists, and before that the onboarding stash.
  const stash = readOnboardingStash(ws?.onboarding);
  const hours = account ? readWorkingHours(account.working_hours) : readWorkingHours(stash.workingHours);
  const timezone = me?.timezone || "UTC";

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <Section
        id="sending"
        title="Sending hours"
        description="Nora only invites, messages, likes and comments inside these hours, in your timezone. Outside them it waits."
      >
        <form action={saveHours} className="card profile-card profile-form">
          <p className="profile-now">
            <span className="small muted">Right now:</span> {describeWorkingHours(hours, timezone)}
          </p>
          <div className="profile-fields">
            {/* Hours said the way the reader says them. Two number boxes reading
                8 and 18 asked an American customer to do 24-hour arithmetic on
                the one setting that decides when their account may act; the
                values posted are unchanged. */}
            <div className="profile-field-pair">
              <label className="field">
                <span>From</span>
                <select name="start" defaultValue={String(hours.start)}>
                  {HOURS.filter((h) => h < 24).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Until</span>
                <select name="end" defaultValue={String(hours.end)}>
                  {HOURS.filter((h) => h > 0).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* A group, so a screen reader says "Sending days" before "Mon,
                checkbox": seven bare checkboxes are seven unexplained days. */}
            <fieldset className="profile-days">
              <legend>Sending days</legend>
              <div className="profile-day-list">
                {DAYS.map((day) => (
                  <label key={day.value} className="profile-day">
                    <input type="checkbox" name={`day-${day.value}`} defaultChecked={hours.days.includes(day.value)} />
                    <span>{day.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>Your timezone</span>
              <TimezoneSelect value={timezone} />
              <span className="hint">Meeting times offered to prospects use this zone too.</span>
            </label>
          </div>
          <div className="profile-form-foot">
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </div>
        </form>
      </Section>
    </>
  );
}
