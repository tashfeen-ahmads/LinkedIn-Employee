import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

/** Step 4 of the product: show up prepared, close. */
export default async function MeetingsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, prospect_id, starts_at, ends_at, meeting_url, brief, status")
    .eq("workspace_id", session.workspaceId)
    .gte("starts_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(50);

  if (!meetings?.length) {
    return (
      <>
        <div className="page-head">
          <h1>Meetings</h1>
          <p className="muted">
            Nothing booked yet. When the Reply Agent books one it appears here with a brief on who you are
            meeting.
          </p>
        </div>
      </>
    );
  }

  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, title, company, linkedin_url, fit_reasons")
    .in("id", meetings.map((m) => m.prospect_id));
  const prospectById = new Map((prospects ?? []).map((p) => [p.id, p]));

  return (
    <>
      <h1>Meetings</h1>
      <div className="grid">
        {meetings.map((meeting) => {
          const prospect = prospectById.get(meeting.prospect_id);
          const reasons = Array.isArray(prospect?.fit_reasons) ? (prospect.fit_reasons as string[]) : [];
          return (
            <article key={meeting.id} className="card">
              <header className="between">
                <div>
                  <strong>
                    {prospect ? `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() : "Prospect"}
                  </strong>
                  <p className="small muted">
                    {[prospect?.title, prospect?.company].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="num">
                  <p className="mono small">
                    {new Date(meeting.starts_at).toLocaleString()}
                  </p>
                  {meeting.meeting_url ? (
                    <a className="small" href={meeting.meeting_url} target="_blank" rel="noreferrer noopener">
                      Join link
                    </a>
                  ) : null}
                </div>
              </header>
              {reasons.length ? (
                <p className="small muted">
                  Why they matched: {reasons.join("; ")}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
