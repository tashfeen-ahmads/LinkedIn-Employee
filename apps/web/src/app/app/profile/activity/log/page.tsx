import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { Empty, LoadFailed, Section } from "@/components/page";
import { formatDateTime, formatWhen, isoAttr } from "@/lib/format";

/**
 * What Nora liked and commented on (rule 68). The switch is on the LinkedIn
 * activity section; this is its log, one click from it.
 *
 * Every like and comment goes out under the rep's own name, so every one of
 * them is listed here with the words of the post and of the comment. Nothing
 * done in somebody's name should be invisible to them.
 */
export default async function ActivityLogPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: actions, error }, { data: me }] = await Promise.all([
    supabase
      .from("engagement_actions")
      .select("id, prospect_id, kind, body, post_excerpt, post_url, status, reason, scheduled_for, sent_at, created_at")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
    // Times in the rep's own timezone: the server renders in UTC.
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);
  const ids = [...new Set((actions ?? []).map((a) => a.prospect_id).filter(Boolean))] as string[];
  const { data: people } = ids.length
    ? await supabase.from("prospects").select("id, first_name, last_name, company").in("id", ids)
    : { data: [] };
  const who = new Map((people ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || "A prospect"]));
  const sentLikes = (actions ?? []).filter((a) => a.kind === "reaction" && a.status === "sent").length;
  const sentComments = (actions ?? []).filter((a) => a.kind === "comment" && a.status === "sent").length;

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <p className="small">
        <Link href="/app/profile/activity">← LinkedIn activity</Link>
      </p>
      <Section
        id="log"
        title="Activity log"
        description={`Every like and comment Nora made in your name, with the words of the post and of the comment. ${sentLikes} likes and ${sentComments} comments in the last 100.`}
      >
        {error ? (
          <LoadFailed what="Likes and comments" />
        ) : !actions?.length ? (
          <Empty title="Nothing yet.">
            Likes and comments start once a campaign is running and the people in it post something recent.
          </Empty>
        ) : (
          <div className="table-scroll card-rows">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>What</th>
                  <th>Their post</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id}>
                    <td>{a.prospect_id ? who.get(a.prospect_id) ?? "A prospect" : "Someone in your network"}</td>
                    <td data-label="What">
                      {a.kind === "comment" ? (
                        <>
                          Commented
                          {a.body ? <p className="small muted">{a.body}</p> : null}
                        </>
                      ) : (
                        "Liked"
                      )}
                    </td>
                    <td data-label="Their post" className="small muted">
                      {a.post_url ? (
                        <a href={a.post_url} target="_blank" rel="noreferrer">
                          {(a.post_excerpt ?? "").slice(0, 140) || "Open the post"}
                        </a>
                      ) : (
                        (a.post_excerpt ?? "").slice(0, 140)
                      )}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`pill tiny ${a.status === "sent" ? "positive" : a.status === "failed" ? "danger" : a.status === "skipped" ? "plain" : ""}`}
                        title={a.reason ?? undefined}
                      >
                        {a.status === "sent" ? "Done" : a.status === "queued" ? "Planned" : a.status === "sending" ? "Sending" : a.status === "skipped" ? "Skipped" : a.status === "failed" ? "Failed" : a.status}
                      </span>
                    </td>
                    <td data-label="When" className="small subtle">
                      <time
                        dateTime={isoAttr(a.sent_at ?? a.scheduled_for ?? a.created_at)}
                        title={formatDateTime(a.sent_at ?? a.scheduled_for ?? a.created_at, me?.timezone)}
                      >
                        {formatWhen(a.sent_at ?? a.scheduled_for ?? a.created_at, me?.timezone)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}