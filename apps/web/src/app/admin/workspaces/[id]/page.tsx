import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, statsByWorkspace, daysUntil, formatUsd, type WorkspaceStats } from "@/lib/admin";
import { dailyInviteCap } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";

export const dynamic = "force-dynamic";

/**
 * One workspace, in enough detail to answer "why is nothing happening".
 *
 * That question has a small number of real answers — no LinkedIn account, an
 * account that has never sent, a campaign still in draft, a restricted account,
 * an expired trial — and they are all on this page, so the answer is read
 * rather than deduced from four other screens.
 */
export default async function AdminWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug, plan, seats, trial_ends_at, subscription_status, current_period_end, created_at, data_retention_days")
    .eq("id", id)
    .maybeSingle();
  if (!workspace) notFound();

  // The fake database throws on embedded joins and PostgREST cannot be relied
  // on to shape them the same way, so memberships and profiles are fetched
  // separately and joined here. Same pattern as digest.ts.
  const [{ data: members }, { data: accounts }, { data: campaigns }, { data: stats }, { data: spend }, { data: events }] =
    await Promise.all([
      supabase.from("memberships").select("id, user_id, role, created_at").eq("workspace_id", id),
      supabase
        .from("linkedin_accounts")
        .select("id, user_id, display_name, status, status_detail, has_sales_navigator, invites_today, invites_this_week, messages_today, connected_at, first_action_at, last_action_at")
        .eq("workspace_id", id),
      supabase.from("campaigns").select("id, name, status, daily_invite_cap, reply_mode, launched_at, created_at").eq("workspace_id", id).order("created_at", { ascending: false }),
      supabase.rpc("platform_workspace_stats"),
      supabase.from("llm_calls").select("agent, model, cost_usd, error").eq("workspace_id", id),
      supabase.from("events").select("id, name, subject_type, created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(20),
    ]);

  const userIds = [...new Set((members ?? []).map((m) => m.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, email, full_name, timezone").in("id", userIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const accountByUser = new Map((accounts ?? []).map((a) => [a.user_id, a]));

  const s = statsByWorkspace((stats ?? null) as WorkspaceStats[] | null).get(id);
  const trialDays = daysUntil(workspace.trial_ends_at);

  const priced = (spend ?? []).filter((c) => c.cost_usd !== null);
  const totalSpend = priced.reduce((sum, c) => sum + Number(c.cost_usd), 0);
  const unpriced = (spend ?? []).length - priced.length;
  const failedCalls = (spend ?? []).filter((c) => c.error).length;

  return (
    <>
      <div className="page-head">
        <div className="between">
          <div className="stack-1">
            <h1>{workspace.name}</h1>
            <p className="tiny subtle mono">{workspace.slug}</p>
          </div>
          <Link href="/admin" className="btn ghost small">
            All workspaces
          </Link>
        </div>
      </div>

      <section className="card">
        <h2>Plan</h2>
        <div className="grid grid-4">
          <Stat label="Plan" value={workspace.plan} />
          <Stat label="Seats" value={String(workspace.seats)} />
          <Stat
            label={workspace.plan === "trial" ? "Trial" : "Subscription"}
            value={
              workspace.plan === "trial"
                ? trialDays === null
                  ? "no end date"
                  : trialDays < 0
                    ? `expired ${-trialDays}d ago`
                    : `${trialDays}d left`
                : (workspace.subscription_status ?? "—")
            }
          />
          <Stat label="Signed up" value={new Date(workspace.created_at).toLocaleDateString()} />
        </div>
      </section>

      <section className="card">
        <h2>People</h2>
        {!members?.length ? (
          <p className="small muted">No members. This workspace cannot be used by anyone.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>LinkedIn</th>
                  <th className="num">Today</th>
                  <th className="num">This week</th>
                  <th>Cap</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const p = profileById.get(m.user_id);
                  const a = accountByUser.get(m.user_id);
                  const cap = a ? dailyInviteCap(a.first_action_at ? new Date(a.first_action_at) : null) : null;
                  return (
                    <tr key={m.id}>
                      <td>
                        <span className="small">{p?.full_name ?? "—"}</span>
                        <p className="tiny subtle">{p?.email ?? "—"}</p>
                      </td>
                      <td className="small">{m.role}</td>
                      <td>
                        {!a ? (
                          <span className="pill plain tiny">not connected</span>
                        ) : (
                          <>
                            <span className={`pill tiny ${a.status === "active" ? "positive" : a.status === "restricted" ? "danger" : "warning"}`}>
                              {a.status.replaceAll("_", " ")}
                            </span>
                            {a.status_detail ? <p className="tiny muted">{a.status_detail}</p> : null}
                            {a.has_sales_navigator ? <p className="tiny subtle">Sales Navigator</p> : null}
                          </>
                        )}
                      </td>
                      <td className="num mono">{a ? a.invites_today : "—"}</td>
                      <td className="num mono">{a ? a.invites_this_week : "—"}</td>
                      <td className="small subtle">
                        {a === undefined
                          ? "—"
                          : a.first_action_at
                            ? `${cap}/day`
                            : `${LINKEDIN_LIMITS.invitesPerDayStart}/day, not started`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Work done</h2>
        <div className="grid grid-4">
          <Stat label="Prospects" value={String(s?.prospects ?? 0)} />
          <Stat label="Messages sent" value={String(s?.messages_sent ?? 0)} />
          <Stat label="Conversations" value={String(s?.conversations ?? 0)} />
          <Stat label="Waiting for a human" value={String(s?.pending_drafts ?? 0)} />
        </div>
        <p className="tiny subtle">
          Counts only. The rows behind these are the workspace&rsquo;s own customers&rsquo; data and are not
          readable from here.
        </p>
      </section>

      <section className="card">
        <h2>Campaigns</h2>
        {!campaigns?.length ? (
          <p className="small muted">
            None built yet. A campaign is created by the Targeting Agent once a customer profile is
            approved on /app/strategy.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Replies</th>
                  <th className="num">Cap</th>
                  <th>Launched</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="small">{c.name}</td>
                    <td>
                      <span className={`pill tiny ${c.status === "running" ? "positive" : "plain"}`}>{c.status}</span>
                    </td>
                    <td className="small">{c.reply_mode}</td>
                    <td className="num mono">{c.daily_invite_cap ?? "—"}</td>
                    <td className="small subtle">
                      {c.launched_at ? new Date(c.launched_at).toLocaleDateString() : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Model spend</h2>
        <div className="grid grid-4">
          <Stat label="Total" value={formatUsd(totalSpend)} />
          <Stat label="Calls" value={String((spend ?? []).length)} />
          <Stat label="Failed" value={String(failedCalls)} />
          <Stat label="Unpriced" value={String(unpriced)} />
        </div>
        {unpriced ? (
          <p className="tiny subtle">
            {unpriced} call{unpriced === 1 ? "" : "s"} used a model missing from the price table, so
            {unpriced === 1 ? " it is" : " they are"} excluded rather than counted as zero.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>Recent activity</h2>
        {!events?.length ? (
          <p className="small muted">Nothing recorded yet.</p>
        ) : (
          <ul className="bullets">
            {events.map((e) => (
              <li key={e.id} className="small">
                <span className="mono">{e.name}</span>{" "}
                <span className="subtle">{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
