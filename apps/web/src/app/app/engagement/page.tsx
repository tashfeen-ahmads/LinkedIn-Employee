import { LINKEDIN_LIMITS } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { Empty, LoadFailed, PageHeader, Section } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { isoAttr } from "@/lib/format";

/**
 * What Nora liked and commented on, and the switch for it (rule 68).
 *
 * Every like and comment goes out under the rep's own name, so every one of
 * them is listed here with the words of the post and of the comment. Nothing
 * done in somebody's name should be invisible to them.
 */
export default async function EngagementPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: workspace }, { data: actions, error }] = await Promise.all([
    supabase.from("workspaces").select("engage_posts").eq("id", session.workspaceId).maybeSingle(),
    supabase
      .from("engagement_actions")
      .select("id, prospect_id, kind, body, post_excerpt, post_url, status, reason, scheduled_for, sent_at, created_at")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const ids = [...new Set((actions ?? []).map((a) => a.prospect_id).filter(Boolean))] as string[];
  const { data: people } = ids.length
    ? await supabase.from("prospects").select("id, first_name, last_name, company").in("id", ids)
    : { data: [] };
  const who = new Map((people ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || "A prospect"]));
  const on = workspace?.engage_posts !== false;
  const canChange = ["owner", "admin"].includes(session.role);
  const sentLikes = (actions ?? []).filter((a) => a.kind === "reaction" && a.status === "sent").length;
  const sentComments = (actions ?? []).filter((a) => a.kind === "comment" && a.status === "sent").length;

  return (
    <>
      <PageHeader
        title="Likes and comments"
        lede="Nora likes and comments on recent posts from the people you are in touch with, so your profile is active and your name is familiar before they read your message."
      />
      <PageNotice error={params.error} notice={params.notice} />

      <Section
        framed
        title={on ? "On" : "Off"}
        description={`At most ${LINKEDIN_LIMITS.reactionsPerDay} likes and ${LINKEDIN_LIMITS.commentsPerDay} comments a day, spread across your working hours, and never more than one of each on the same person in a week. Each comment responds to something the person actually wrote. Nothing is posted on anything about grief, illness, losing a job or politics, and nothing while LinkedIn is holding your account's invitations.`}
        action={
          canChange ? (
            <form action="/app/engagement/toggle" method="post">
              <input type="hidden" name="on" value={on ? "false" : "true"} />
              <SubmitButton className={`btn small${on ? " secondary" : ""}`} pendingLabel="Saving…">
                {on ? "Turn off" : "Turn on"}
              </SubmitButton>
            </form>
          ) : null
        }
      />

      <Section title="What Nora did" description={`${sentLikes} likes and ${sentComments} comments in the last 100 actions.`}>
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
                        {a.status === "sent" ? "done" : a.status === "queued" ? "planned" : a.status}
                      </span>
                    </td>
                    <td data-label="When" className="small subtle">
                      <time dateTime={isoAttr(a.sent_at ?? a.scheduled_for ?? a.created_at)}>
                        {new Date(a.sent_at ?? a.scheduled_for ?? a.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
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
