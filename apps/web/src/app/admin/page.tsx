import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, statsByWorkspace, daysUntil, formatUsd, type WorkspaceStats } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Every workspace on the platform, and whether it is actually working.
 *
 * Ordered newest first, because the question an operator has most often is
 * "what happened to the one that signed up this morning" — not "show me the
 * biggest". A workspace that has never sent anything is the interesting case,
 * and sorting by size buries it.
 */
export default async function AdminWorkspacesPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: workspaces }, { data: members }, { data: accounts }, { data: campaigns }, { data: stats }, { data: spend }] =
    await Promise.all([
      supabase.from("workspaces").select("id, name, slug, plan, seats, trial_ends_at, subscription_status, created_at").order("created_at", { ascending: false }),
      supabase.from("memberships").select("workspace_id, user_id"),
      supabase.from("linkedin_accounts").select("workspace_id, status, invites_today, first_action_at"),
      supabase.from("campaigns").select("workspace_id, status"),
      supabase.rpc("platform_workspace_stats"),
      supabase.from("llm_calls").select("workspace_id, cost_usd"),
    ]);

  const byWorkspace = statsByWorkspace((stats ?? null) as WorkspaceStats[] | null);
  const memberCount = tally(members, "workspace_id");
  const campaignCount = tally(campaigns?.filter((c) => c.status === "running") ?? null, "workspace_id");

  // A model missing from the price table costs null, never zero — so a null
  // here means "not priced", and adding it as zero would report a number that
  // is wrong in the flattering direction.
  const costs = new Map<string, number>();
  for (const row of spend ?? []) {
    // workspace_id is nullable on llm_calls — a call made before a workspace
    // exists has nowhere to charge itself to.
    if (row.cost_usd === null || !row.workspace_id) continue;
    costs.set(row.workspace_id, (costs.get(row.workspace_id) ?? 0) + Number(row.cost_usd));
  }

  const accountsByWorkspace = new Map<string, { status: string; invites_today: number; first_action_at: string | null }[]>();
  for (const a of accounts ?? []) {
    const list = accountsByWorkspace.get(a.workspace_id) ?? [];
    list.push(a);
    accountsByWorkspace.set(a.workspace_id, list);
  }

  const totalSpend = [...costs.values()].reduce((sum, n) => sum + n, 0);
  const everSent = (workspaces ?? []).filter((w) =>
    (accountsByWorkspace.get(w.id) ?? []).some((a) => a.first_action_at),
  ).length;

  return (
    <>
      <div className="page-head">
        <h1>Workspaces</h1>
        <p className="muted small">
          {workspaces?.length ?? 0} total · {everSent} have ever sent · {formatUsd(totalSpend)} of model spend
        </p>
      </div>

      {!workspaces?.length ? (
        <div className="notice">
          <p>No workspaces yet. The first signup will appear here.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Plan</th>
                <th className="num">People</th>
                <th>LinkedIn</th>
                <th className="num">Running</th>
                <th className="num">Prospects</th>
                <th className="num">Sent</th>
                <th className="num">Waiting</th>
                <th className="num">Spend</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => {
                const s = byWorkspace.get(w.id);
                const accs = accountsByWorkspace.get(w.id) ?? [];
                const trialDays = daysUntil(w.trial_ends_at);
                return (
                  <tr key={w.id}>
                    <td>
                      <Link href={`/admin/workspaces/${w.id}`}>{w.name}</Link>
                      <p className="tiny subtle mono">{w.slug}</p>
                    </td>
                    <td>
                      <span className="small">{w.plan}</span>
                      {w.plan === "trial" && trialDays !== null ? (
                        <p className={`tiny ${trialDays < 0 ? "danger-text" : "subtle"}`}>
                          {trialDays < 0 ? `expired ${-trialDays}d ago` : `${trialDays}d left`}
                        </p>
                      ) : null}
                    </td>
                    <td className="num">{memberCount.get(w.id) ?? 0}</td>
                    <td><AccountCell accounts={accs} /></td>
                    <td className="num">{campaignCount.get(w.id) ?? 0}</td>
                    <td className="num">{s?.prospects ?? 0}</td>
                    <td className="num">{s?.messages_sent ?? 0}</td>
                    <td className="num">{s?.pending_drafts ?? 0}</td>
                    <td className="num mono">{formatUsd(costs.get(w.id) ?? 0)}</td>
                    <td className="small subtle">{new Date(w.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="tiny subtle">
        Prospect names, conversations and message bodies are not readable here. Supporting a workspace
        does not require reading its customers&rsquo; mail, so those tables are counted rather than listed.
      </p>
    </>
  );
}

/** The health of a workspace's LinkedIn accounts, said in one cell. */
function AccountCell({ accounts }: { accounts: { status: string; first_action_at: string | null }[] }) {
  if (!accounts.length) return <span className="pill plain tiny">none</span>;
  const bad = accounts.filter((a) => a.status !== "active");
  if (bad.length) {
    return (
      <span className={`pill tiny ${bad.some((a) => a.status === "restricted") ? "danger" : "warning"}`}>
        {bad[0]?.status.replaceAll("_", " ")}
      </span>
    );
  }
  const idle = accounts.every((a) => !a.first_action_at);
  return <span className={`pill tiny ${idle ? "plain" : "positive"}`}>{idle ? "connected, idle" : "sending"}</span>;
}

function tally<T extends Record<string, unknown>>(rows: T[] | null, key: keyof T): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = String(row[key]);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
