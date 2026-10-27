import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { EXTERNAL_BOOKINGS_UNCOUNTED, checkCtaUrl } from "@le/shared";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { AVAILABILITY_DEFAULTS } from "@/lib/availability";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/page";
import { PROFILE_SECTIONS, daysInWords, hourLabel, readWorkingHours, zonePlace } from "../sections";

const HERE = PROFILE_SECTIONS.meetings;

/**
 * How a prospect books a call: the rep's own scheduling link, or times offered
 * from the calendar here (rule 31).
 *
 * A booking URL is checked before it is stored because the agent sends it to a
 * stranger under this person's name. The meeting hours themselves are edited
 * on Meetings, which owns them (`saveAvailability`); this section says what
 * they are and links there, rather than keeping a second copy of that form.
 */
async function saveMeetings(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const raw = String(formData.get("bookingUrl") ?? "").trim();
  let bookingUrl: string | null = null;
  if (raw) {
    // The reason is shown rather than a generic refusal: somebody who pasted
    // "cal.com/sam" needs telling it is missing the https://.
    const checked = checkCtaUrl(raw);
    if (!checked.ok) redirect(errorQuery(HERE, checked.reason));
    bookingUrl = checked.url;
  }

  const { data: saved, error } = await supabase
    .from("profiles")
    .update({ booking_url: bookingUrl })
    .eq("id", session.userId)
    .select("id");
  if (error || !saved?.length) redirect(errorQuery(HERE, "Your scheduling link could not be saved. Please try again."));

  revalidatePath("/app/profile", "layout");
  redirect(
    noticeQuery(
      HERE,
      bookingUrl
        ? "Saved. Nora sends this link when somebody wants to talk."
        : "Saved. Nora offers times from your meeting hours instead.",
    ),
  );
}

export default async function MeetingsSectionPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const [{ data: me }, { data: availability }] = await Promise.all([
    supabase.from("profiles").select("booking_url, timezone").eq("id", session.userId).maybeSingle(),
    supabase
      .from("availability")
      .select("timezone, working_hours, meeting_minutes, max_per_day")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);
  const ownLink = me?.booking_url ?? null;
  const hours = availability ? readWorkingHours(availability.working_hours) : null;

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <Section id="meetings" title="Meetings" description="How somebody who wants to talk books a time with you.">
        <form action={saveMeetings} className="card profile-card profile-form">
          <div className="profile-fields">
            <label className="field">
              <span>Your own scheduling link (optional)</span>
              <input
                type="url"
                name="bookingUrl"
                autoComplete="url"
                spellCheck={false}
                placeholder="https://cal.com/you/intro"
                defaultValue={ownLink ?? ""}
              />
              <span className="hint">
                Calendly or Cal.com. Leave it empty and Nora offers times from your meeting hours below.
              </span>
            </label>
          </div>
          {ownLink ? <p className="small muted">{EXTERNAL_BOOKINGS_UNCOUNTED}</p> : null}
          <div className="profile-form-foot">
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </div>
        </form>
      </Section>

      <Section
        id="meeting-hours"
        title="Meeting hours"
        description={
          ownLink
            ? "Not used while your own link is set: your scheduling page decides when you are free."
            : "The times Nora offers when somebody wants a call."
        }
        action={
          <Link className="btn secondary small" href="/app/meetings?tab=availability">
            Change meeting hours
          </Link>
        }
      >
        <div className="card profile-card">
          {hours && availability ? (
            <dl className="profile-facts">
              <div>
                <dt>Hours</dt>
                <dd>
                  {hourLabel(hours.start)} to {hourLabel(hours.end)}, {daysInWords(hours.days)}
                </dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{zonePlace(availability.timezone)}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{availability.meeting_minutes} minutes</dd>
              </div>
              <div>
                <dt>At most</dt>
                <dd>
                  {availability.max_per_day} {availability.max_per_day === 1 ? "meeting" : "meetings"} a day
                </dd>
              </div>
            </dl>
          ) : (
            <p className="small muted">
              Not chosen yet, so the defaults apply: {hourLabel(AVAILABILITY_DEFAULTS.start)} to{" "}
              {hourLabel(AVAILABILITY_DEFAULTS.end)}, {daysInWords([...AVAILABILITY_DEFAULTS.days])},{" "}
              {AVAILABILITY_DEFAULTS.meetingMinutes} minute calls.
            </p>
          )}
        </div>
      </Section>
    </>
  );
}
