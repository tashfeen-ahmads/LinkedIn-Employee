import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, daysUntil } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * The support queue: everything on the platform that a person needs to look at.
 *
 * Built from the states that stop a workspace working rather than from a ticket
 * system, because nobody files a ticket for "my account has been restricted for
 * three days and I assumed that was normal". The list being empty is the point.
 */
export default async function AdminSupportPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: accounts }, { data: workspaces }, { data: failures }] = await Promise.all([
    supabase
      .from("linkedin_accounts")
      .select("id, workspace_id, user_id, status, status_detail, display_name, connected_at, first_action_at")
      .neq("status", "active"),
    supabase.from("workspaces").select("id, name, plan, trial_ends_at, subscription_status"),
    // An agent call that errored is the clearest signal something is wrong that
    // the customer cannot see and would not know to report.
    supabase
      .from("llm_calls")
      .select("id, workspace_id, agent, model, error, created_at")
      .not("error", "is", null)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const names = new Map((workspaces ?? []).map((w) => [w.id, w.name]));

  const expiring = (workspaces ?? [])
    .filter((w) => w.plan === "trial" && w.trial_ends_at)
    .map((w) => ({ ...w, days: daysUntil(w.trial_ends_at) }))
    .filter((w) => w.days !== null && w.days <= 3)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const nothing = !accounts?.length && !failures?.length && !expiring.length;

  return (
    <>
      <div className="page-head">
        <h1>Needs attention</h1>
        <p className="muted small">
          States that stop a workspace working. Nobody reports these, because from the inside they
          look like the product being quiet.
        </p>
      </div>

      {nothing ? (
        <div className="notice positive">
          <p>Nothing needs attention. Every connected account is healthy and no agent call has failed.</p>
        </div>
      ) : null}

      {accounts?.length ? (
        <section className="card">
          <h2>LinkedIn accounts not sending</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Connected</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/admin/workspaces/${a.workspace_id}`}>
                        {names.get(a.workspace_id) ?? "—"}
                      </Link>
                    </td>
                    <td className="small">{a.display_name ?? "—"}</td>
                    <td>
                      <span className={`pill tiny ${a.status === "restricted" ? "danger" : "warning"}`}>
                        {a.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="small muted">{a.status_detail ?? "—"}</td>
                    <td className="small subtle">
                      {a.connected_at ? new Date(a.connected_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {expiring.length ? (
        <section className="card">
          <h2>Trials ending</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th className="num">Days left</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link href={`/admin/workspaces/${w.id}`}>{w.name}</Link>
                    </td>
                    <td className="num">
                      {(w.days ?? 0) < 0 ? `expired ${-(w.days ?? 0)}d ago` : w.days}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {failures?.length ? (
        <section className="card">
          <h2>Failed agent calls</h2>
          <p className="small muted">
            The most recent 25. A refusal or a schema failure here means a draft that never appeared.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Workspace</th>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td className="small subtle">{new Date(f.created_at).toLocaleString()}</td>
                    <td>
                      {/* Nullable: a call can fail before it has a workspace to
                          charge itself to. */}
                      {f.workspace_id ? (
                        <Link href={`/admin/workspaces/${f.workspace_id}`}>
                          {names.get(f.workspace_id) ?? "—"}
                        </Link>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td className="small">{f.agent}</td>
                    <td className="small mono">{f.model}</td>
                    <td className="small muted">{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
