import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";

/**
 * When this rep will take a call, and when they will not.
 *
 * This is the whole of what our calendar knows. There is no Google account
 * behind it to notice a meeting booked somewhere else — Google will not grant
 * calendar scopes to an app that has not been through brand verification, and
 * that needs a verified domain and a review measured in weeks. So the trade is
 * named on the page rather than buried: keep the hours honest and block out
 * anything booked elsewhere, or a prospect will pick a time you are not free.
 */

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const DEFAULTS = {
  timezone: "UTC",
  working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
  meeting_minutes: 30,
  min_notice_hours: 12,
  buffer_minutes: 15,
  max_per_day: 3,
  location: "",
};

async function saveAvailability(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const days = DAYS.filter((d) => formData.get(`day-${d.value}`)).map((d) => d.value);
  const meetingMinutes = Number(formData.get("meetingMinutes"));
  const minNotice = Number(formData.get("minNoticeHours"));
  const buffer = Number(formData.get("bufferMinutes"));
  const maxPerDay = Number(formData.get("maxPerDay"));

  // Checked here as well as in the database. The constraint is the thing that
  // cannot be bypassed; this is the thing that says why, on the screen where it
  // can be fixed, instead of returning a Postgres error nobody can read.
  const problem =
    !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end <= start
      ? "Working hours need a start before an end, between 0 and 24."
      : days.length === 0
        ? "Pick at least one day, or nothing can ever be booked."
        : meetingMinutes < 10 || meetingMinutes > 240
          ? "A meeting is between 10 and 240 minutes."
          : minNotice < 0 || minNotice > 336
            ? "Notice is between 0 and 336 hours."
            : buffer < 0 || buffer > 120
              ? "A buffer is between 0 and 120 minutes."
              : maxPerDay < 1 || maxPerDay > 20
                ? "Between 1 and 20 meetings a day."
                : null;
  if (problem) redirect(errorQuery("/app/meetings", problem));

  await supabase.from("availability").upsert(
    {
      workspace_id: session.workspaceId,
      user_id: session.userId,
      timezone: String(formData.get("timezone") ?? "UTC").trim() || "UTC",
      working_hours: { start, end, days } as never,
      meeting_minutes: meetingMinutes,
      min_notice_hours: minNotice,
      buffer_minutes: buffer,
      max_per_day: maxPerDay,
      location: String(formData.get("location") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id" },
  );

  revalidatePath("/app/meetings");
}

async function addBlackout(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const starts = Date.parse(from);
  const ends = Date.parse(to);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) {
    redirect(errorQuery("/app/meetings", "A blocked period needs a start and a later end."));
  }

  await supabase.from("availability_blackouts").insert({
    workspace_id: session.workspaceId,
    user_id: session.userId,
    starts_at: new Date(starts).toISOString(),
    ends_at: new Date(ends).toISOString(),
    reason: String(formData.get("reason") ?? "").trim() || null,
  });

  redirect(noticeQuery("/app/meetings", "Blocked. Nothing will be offered in that window."));
}

async function removeBlackout(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("availability_blackouts")
    .delete()
    .eq("id", String(formData.get("id")))
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId);
  revalidatePath("/app/meetings");
}

/**
 * Attaching the rep's real calendar, read-only, with no OAuth.
 *
 * Google and Outlook both publish a secret .ics address from their own
 * settings, so this needs no scopes and no brand verification — the thing that
 * made a Google integration impossible on a deployment without a verified
 * domain. It only ever reads, and it closes the gap that otherwise makes the
 * blackout list the sole defence against double-booking.
 */
async function connectFeed(formData: FormData) {
  "use server";
  const session = await requireSession();
  const url = String(formData.get("url") ?? "").trim();

  const result = await callWorker<{ events?: number }>("/jobs/calendar-feed", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    url,
  });
  if (!result.ok) redirect(errorQuery("/app/meetings", result.error));

  const events = result.data?.events ?? 0;
  redirect(
    noticeQuery(
      "/app/meetings",
      events > 0
        ? `Calendar connected. ${events} busy period${events === 1 ? "" : "s"} read — nothing will be offered against them.`
        : "Calendar connected. It has nothing in the next six weeks, so nothing is blocked yet.",
    ),
  );
}

async function disconnectFeed() {
  "use server";
  const session = await requireSession();
  await callWorker("/jobs/calendar-feed", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    url: null,
  });
  redirect(
    noticeQuery(
      "/app/meetings",
      "Calendar disconnected. Only the times you block by hand are protected now.",
    ),
  );
}

export async function Availability() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: row }, { data: blackouts }, { data: feed }] = await Promise.all([
    supabase
      .from("availability")
      .select("timezone, working_hours, meeting_minutes, min_notice_hours, buffer_minutes, max_per_day, location")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase
      .from("availability_blackouts")
      .select("id, starts_at, ends_at, reason")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(20),
    // Never `url_encrypted`. The host is enough for a rep to recognise which
    // calendar this is, and the address itself is a credential that would let
    // anyone holding it read their whole diary.
    supabase
      .from("calendar_feeds")
      .select("url_host, status, last_synced_at, last_error, event_count")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);

  const current = { ...DEFAULTS, ...(row ?? {}) };
  const hours = parseHours(current.working_hours);

  return (
    <>
      <section className="card stack-4">
        <div className="stack-1">
          <h3>When you will take a call</h3>
          <p className="small muted prose">
            These are the only times a prospect can be offered. They are separate from your sending
            hours on the Team page on purpose — when you are happy for invitations to go out and when
            you are happy to be in a meeting are different questions.
          </p>
        </div>

        <form action={saveAvailability} className="stack-3">
          <div className="form-row">
            <label className="field compact">
              <span>From</span>
              <input type="number" name="start" min={0} max={23} defaultValue={hours.start} />
            </label>
            <label className="field compact">
              <span>To</span>
              <input type="number" name="end" min={1} max={24} defaultValue={hours.end} />
            </label>
            <div className="cluster-3">
              {DAYS.map((day) => (
                <label key={day.value} className="small check">
                  <input type="checkbox" name={`day-${day.value}`} defaultChecked={hours.days.includes(day.value)} />
                  {day.label}
                </label>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label className="field compact">
              <span>Meeting length</span>
              <input type="number" name="meetingMinutes" min={10} max={240} step={5} defaultValue={current.meeting_minutes} />
            </label>
            <label className="field compact">
              <span>Least notice (hours)</span>
              <input type="number" name="minNoticeHours" min={0} max={336} defaultValue={current.min_notice_hours} />
            </label>
            <label className="field compact">
              <span>Gap either side (min)</span>
              <input type="number" name="bufferMinutes" min={0} max={120} step={5} defaultValue={current.buffer_minutes} />
            </label>
            <label className="field compact">
              <span>Most per day</span>
              <input type="number" name="maxPerDay" min={1} max={20} defaultValue={current.max_per_day} />
            </label>
          </div>

          <div className="form-row">
            <label className="field grow">
              <span>Your timezone</span>
              <input name="timezone" defaultValue={current.timezone} placeholder="Europe/London" />
            </label>
            <label className="field grow">
              <span>Where the meeting happens</span>
              <input
                name="location"
                defaultValue={current.location ?? ""}
                placeholder="Zoom link, phone number, or an address"
              />
            </label>
            <button className="btn" type="submit">
              Save
            </button>
          </div>
        </form>

        <p className="tiny subtle prose">
          {feed?.status === "ok"
            ? "Your own calendar is being read as well, so anything already in it is protected."
            : "This calendar knows about meetings booked here and nothing else. Connect your own calendar below, or block time by hand, or a prospect can pick a time you are not free."}
        </p>
      </section>

      <section className="card stack-4">
        <div className="stack-1">
          <h3>Your own calendar</h3>
          <p className="small muted prose">
            Read-only, and no sign-in. Google Calendar and Outlook both publish a secret address for
            your calendar — paste it here and nothing will be offered on top of anything already in
            your diary. We only ever read it; we never write to it and never show the address again.
          </p>
        </div>

        {feed ? (
          <>
            <div className="between">
              <div className="stack-1">
                <strong className="small">{feed.url_host}</strong>
                <p className="tiny subtle">
                  {feed.status === "ok"
                    ? `${feed.event_count} busy period${feed.event_count === 1 ? "" : "s"} · last read ${
                        feed.last_synced_at ? new Date(feed.last_synced_at).toLocaleString() : "just now"
                      }`
                    : "Not being read."}
                </p>
              </div>
              <form action={disconnectFeed}>
                <button className="btn ghost small" type="submit">
                  Disconnect
                </button>
              </form>
            </div>

            {feed.status !== "ok" ? (
              /* Loud, because the dangerous state is not "no calendar" but "a
                 calendar the rep believes is being watched and is not". The
                 last good snapshot is still being honoured, and it is getting
                 older every day. */
              <div className="notice danger">
                <p>
                  <strong>Your calendar is not being read.</strong> {feed.last_error}
                </p>
                <p className="small">
                  The times from the last successful read are still being avoided, but anything you
                  have added since is not. Paste the address again below.
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        <form action={connectFeed} className="form-row">
          <label className="field grow">
            <span>{feed ? "Replace the address" : "Secret calendar address"}</span>
            <input
              name="url"
              type="url"
              required
              maxLength={2000}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            />
          </label>
          <button className="btn secondary" type="submit">
            {feed ? "Replace" : "Connect"}
          </button>
        </form>

        <p className="tiny subtle prose">
          In Google Calendar: Settings → your calendar → <em>Secret address in iCal format</em>. In
          Outlook: Settings → Calendar → Shared calendars → publish, and take the ICS link. Treat it
          like a password — anyone with it can read your calendar.
        </p>
      </section>

      <section className="card stack-4">
        <div className="stack-1">
          <h3>Time you are not available</h3>
          <p className="small muted">
            Holiday, or a meeting booked somewhere else. Nothing is offered inside these.
          </p>
        </div>

        <form action={addBlackout} className="form-row">
          <label className="field compact">
            <span>From</span>
            <input type="datetime-local" name="from" required />
          </label>
          <label className="field compact">
            <span>To</span>
            <input type="datetime-local" name="to" required />
          </label>
          <label className="field grow">
            <span>Reason (optional)</span>
            <input name="reason" maxLength={120} placeholder="Client workshop" />
          </label>
          <button className="btn secondary" type="submit">
            Block it
          </button>
        </form>

        {(blackouts ?? []).length === 0 ? (
          <p className="small muted">Nothing blocked.</p>
        ) : (
          <ul className="bullets">
            {blackouts!.map((b) => (
              <li key={b.id} className="between">
                <span className="small">
                  {new Date(b.starts_at).toLocaleString()} → {new Date(b.ends_at).toLocaleString()}
                  {b.reason ? ` · ${b.reason}` : ""}
                </span>
                <form action={removeBlackout}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="btn ghost small" type="submit">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function parseHours(value: unknown): { start: number; end: number; days: number[] } {
  if (value && typeof value === "object") {
    const v = value as { start?: unknown; end?: unknown; days?: unknown };
    if (typeof v.start === "number" && typeof v.end === "number" && Array.isArray(v.days)) {
      return { start: v.start, end: v.end, days: v.days as number[] };
    }
  }
  return DEFAULTS.working_hours;
}
