import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * What has happened across the platform, newest first.
 *
 * `events` is the audit trail the app already writes as it works, so this is
 * the record of what people and agents actually did rather than a second one
 * kept for the operator's benefit — a separate trail would drift from the real
 * one and be believed anyway.
 *
 * The payload is deliberately not rendered. It carries whatever the emitting
 * call put in it, which for some events includes a prospect's name.
 */
export default async function AdminActivityPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: events }, { data: workspaces }, { data: profiles }] = await Promise.all([
    supabase
      .from("events")
      .select("id, workspace_id, name, actor_user_id, subject_type, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("workspaces").select("id, name"),
    supabase.from("profiles").select("id, email, full_name"),
  ]);

  const workspaceName = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  return (
    <>
      <div className="page-head">
        <h1>Activity</h1>
        <p className="muted small">
          The 100 most recent events across every workspace, from the same audit trail the app writes
          as it works.
        </p>
      </div>

      {!events?.length ? (
        <div className="notice">
          <p>Nothing has happened yet.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Workspace</th>
                <th>Event</th>
                <th>Who</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="small subtle">{new Date(e.created_at).toLocaleString()}</td>
                  <td>
                    <Link href={`/admin/workspaces/${e.workspace_id}`}>
                      {workspaceName.get(e.workspace_id) ?? "—"}
                    </Link>
                  </td>
                  <td className="small mono">{e.name}</td>
                  <td className="small">
                    {e.actor_user_id ? (who.get(e.actor_user_id) ?? "—") : <span className="subtle">agent</span>}
                  </td>
                  <td className="small subtle">{e.subject_type ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
