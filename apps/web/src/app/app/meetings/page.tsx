import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { PageNotice } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { Availability } from "./availability";

export const dynamic = "force-dynamic";

/**
 * Meetings, and the settings that make one possible.
 *
 * This was a list with four hundred lines of availability settings stacked
 * underneath it: working hours, a calendar feed, and a blackout list, all open
 * at once, so somebody arriving to check who they were seeing on Thursday
 * scrolled through three forms to find out.
 *
 * Tabs, not sections. Both halves belong to this screen — the settings are
 * what turn an offered time into a booking — but only one of them is ever the
 * reason you opened it. They are query-string tabs rather than client state so
 * a tab is a link somebody can bookmark or send to a colleague, and the page
 * still works with no JavaScript at all.
 */
type Tab = "upcoming" | "past" | "availability";

const TABS: { id: Tab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "availability", label: "Availability" },
];

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === params.tab) ? (params.tab as Tab) : "upcoming";

  const session = await requireSession();
  const supabase = await createClient();
  const now = new Date();

  const [{ data: meetings }, { data: me }] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, prospect_id, starts_at, ends_at, meeting_url, brief, status, booked_via")
      .eq("workspace_id", session.workspaceId)
      .order("starts_at", { ascending: true })
      .limit(200),
    supabase.from("profiles").select("booking_url").eq("id", session.userId).maybeSingle(),
  ]);

  const all = meetings ?? [];
  // Cancelled meetings are never "upcoming", whatever their time says.
  const upcoming = all.filter((m) => m.starts_at >= now.toISOString() && m.status !== "cancelled");
  const past = all.filter((m) => m.starts_at < now.toISOString() || m.status === "cancelled").reverse();
  const shown = tab === "past" ? past : upcoming;

  const { data: prospects } = shown.length
    ? await supabase
        .from("prospects")
        .select("id, first_name, last_name, title, company, linkedin_url, fit_reasons")
        .in("id", shown.map((m) => m.prospect_id))
    : { data: [] };
  const prospectById = new Map((prospects ?? []).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader
        title="Meetings"
        lede="Who you are seeing, and the hours the agent is allowed to offer."
        actions={
          me?.booking_url ? (
            <a className="btn ghost small" href={me.booking_url} target="_blank" rel="noreferrer noopener">
              Your booking page
            </a>
          ) : null
        }
      />

      <PageNotice error={params.error} notice={params.notice} />

      <nav className="tabs" aria-label="Meetings">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "upcoming" ? "/app/meetings" : `/app/meetings?tab=${t.id}`}
            className="pill"
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
            {t.id === "upcoming" && upcoming.length ? ` (${upcoming.length})` : ""}
            {t.id === "past" && past.length ? ` (${past.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "availability" ? (
        <Availability />
      ) : shown.length === 0 ? (
        <Empty
          title={tab === "past" ? "Nothing has happened yet." : "Nothing booked yet."}
          action="Set your hours"
          href="/app/meetings?tab=availability"
        >
          The Reply Agent offers times from the hours you set and books the one a prospect accepts.
          It never invents a time: the only slots that reach anybody are the ones this product
          worked out you were free for.
        </Empty>
      ) : (
        <>
          {groupByDay(shown, now).map((group) => (
            <Section key={group.label} title={group.label}>
              <div className="stack-2">
                {group.meetings.map((meeting) => {
                  const prospect = prospectById.get(meeting.prospect_id);
                  const name = prospect
                    ? `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect"
                    : "Prospect";
                  const reasons = Array.isArray(prospect?.fit_reasons)
                    ? (prospect.fit_reasons as string[])
                    : [];
                  const starts = new Date(meeting.starts_at);

                  return (
                    <article key={meeting.id} className="meeting-row card tight">
                      {/* The time first and in its own column: this list is
                          scanned down the left edge, not read across. */}
                      <div className="meeting-when">
                        <span className="meeting-time">
                          {starts.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <span className="tiny subtle">
                          {Math.max(
                            1,
                            Math.round(
                              (new Date(meeting.ends_at).getTime() - starts.getTime()) / 60_000,
                            ),
                          )}{" "}
                          min
                        </span>
                      </div>

                      <div className="meeting-who">
                        <strong>{name}</strong>
                        <p className="small muted">
                          {[prospect?.title, prospect?.company].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {/* Why they matched, right here. It is the one thing
                            worth reading in the thirty seconds before a call,
                            and it used to be a click away on another page. */}
                        {reasons.length ? (
                          <p className="tiny subtle prose">{reasons.slice(0, 2).join("; ")}</p>
                        ) : null}
                      </div>

                      <div className="meeting-actions">
                        {meeting.status === "cancelled" ? (
                          <span className="pill tiny warning">cancelled</span>
                        ) : null}
                        {meeting.booked_via === "link" ? (
                          <span className="pill tiny" title="Booked from a link you sent">
                            self-booked
                          </span>
                        ) : null}
                        {meeting.meeting_url ? (
                          <a
                            className="btn secondary small"
                            href={meeting.meeting_url}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Join
                          </a>
                        ) : null}
                        {prospect?.linkedin_url ? (
                          <a
                            className="btn ghost small"
                            href={prospect.linkedin_url}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Profile
                          </a>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </Section>
          ))}
        </>
      )}
    </>
  );
}

/**
 * Today, Tomorrow, then the date.
 *
 * A flat list of timestamps makes somebody read every row to find out whether
 * anything is today — which is the only question most visits to this page are
 * asking.
 */
function groupByDay<T extends { starts_at: string }>(
  meetings: T[],
  now: Date,
): { label: string; meetings: T[] }[] {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));

  const groups = new Map<string, T[]>();
  for (const meeting of meetings) {
    const key = dayKey(new Date(meeting.starts_at));
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }

  return [...groups.entries()].map(([key, items]) => ({
    label:
      key === today
        ? "Today"
        : key === tomorrow
          ? "Tomorrow"
          : new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            }),
    meetings: items,
  }));
}
