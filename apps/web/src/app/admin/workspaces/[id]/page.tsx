import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, statsByWorkspace, formatUsd, when, type WorkspaceStats } from "@/lib/admin";
import { isoAttr } from "@/lib/format";
import { label as statusLabel } from "@/lib/labels";
import { dailyInviteCap } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";
import { PageHeader, Section } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { ControlButton } from "@/components/admin-control";
import { adminAccountPill } from "@/lib/admin-account";

export const dynamic = "force-dynamic";

/**
 * One workspace, in enough detail to answer "why is nothing happening".
 *
 * That question has a small number of real answers — no LinkedIn account, an
 * account that has never sent, a campaign still in draft, a restricted account,
 * an expired trial — and they are all on this page, so the answer is read
 * rather than deduced from four other screens.
 */
export default async function AdminWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const notice = await searchParams;
  const back = `/admin/workspaces/${id}`;
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
        .select("id, user_id, display_name, status, status_detail, provider_account_id, created_at, has_sales_navigator, invites_today, invites_this_week, messages_today, connected_at, first_action_at, last_action_at, invites_paused_until")
        .eq("workspace_id", id),
      supabase.from("campaigns").select("id, name, status, daily_invite_cap, reply_mode, launched_at, created_at").eq("workspace_id", id).order("created_at", { ascending: false }),
      supabase.rpc("platform_workspace_stats"),
      // Summed in the database. Read row by row this stopped at PostgREST's
      // thousandth row and reported a bill that was quietly short.
      supabase.rpc("platform_workspace_spend"),
      supabase.from("events").select("id, name, subject_type, created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(20),
    ]);

  const userIds = [...new Set((members ?? []).map((m) => m.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, email, full_name, timezone").in("id", userIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const accountByUser = new Map((accounts ?? []).map((a) => [a.user_id, a]));

  const s = statsByWorkspace((stats ?? null) as WorkspaceStats[] | null).get(id);

  const mine = (spend ?? []).find((row) => row.workspace_id === id);
  const totalSpend = Number(mine?.spend_usd ?? 0);
  const callCount = Number(mine?.calls ?? 0);
  const unpriced = callCount - Number(mine?.priced_calls ?? 0);
  const [{ count: failedCalls }, { count: openTickets }] = await Promise.all([
    supabase.from("llm_calls").select("id", { count: "exact", head: true }).eq("workspace_id", id).not("error", "is", null),
    supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("workspace_id", id).eq("status", "open"),
  ]);
  const running = (campaigns ?? []).filter((c) => c.status === "running").length;

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title={workspace.name}
        lede={<span className="mono tiny subtle">{workspace.slug}</span>}
        actions={
          <>
            {running ? (
              <ControlButton
                op="workspace-pause"
                fields={{ workspaceId: id }}
                back={back}
                label={`Pause ${running} running campaign${running === 1 ? "" : "s"}`}
                tone="danger"
                confirm={`Pause all ${running} in ${workspace.name}`}
                pendingLabel="Pausing…"
              />
            ) : null}
            <Link href="/admin/workspaces" className="btn ghost small">
              All workspaces
            </Link>
          </>
        }
      />
      <PageNotice error={notice.error} notice={notice.notice} />

      {/* NORA is free for everyone for now, so there is no plan, seat count or
          trial clock to show — only when the workspace began. */}
      <Section title="Workspace">
        <div className="grid grid-4">
          <Stat label="Signed up" value={when(workspace.created_at)} />
          <Stat label="Open support tickets" value={String(openTickets ?? 0)} />
        </div>
        {openTickets ? (
          <p className="small">
            <Link href="/admin/support">Open the Support tab</Link>
          </p>
        ) : null}
      </Section>

      <Section title="People">
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
                      <td className="small">{statusLabel(m.role)}</td>
                      <td>
                        {!a ? (
                          <span className="pill plain tiny">not connected</span>
                        ) : (
                          <>
                            {(() => {
                              const pill = adminAccountPill(a);
                              return <span className={`pill tiny ${pill.tone}`}>{pill.text}</span>;
                            })()}
                            {a.status_detail ? <p className="tiny muted">{a.status_detail}</p> : null}
                            {a.has_sales_navigator ? <p className="tiny subtle">Sales Navigator</p> : null}
                            {a.invites_paused_until && Date.parse(a.invites_paused_until) > Date.now() ? (
                              <div className="stack-1">
                                <span className="pill tiny warning">LinkedIn hold until {when(a.invites_paused_until)}</span>
                                <ControlButton op="account-clear-hold" fields={{ accountId: a.id }} back={back} label="Clear hold" tone="ghost" />
                              </div>
                            ) : null}
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
      </Section>

      <Section title="Work done">
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
      </Section>

      <Section title="Campaigns">
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
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="small">{c.name}</td>
                    <td>
                      <span className={`pill tiny ${c.status === "running" ? "positive" : "plain"}`}>{statusLabel(c.status)}</span>
                    </td>
                    <td className="small">{c.reply_mode}</td>
                    <td className="num mono">{c.daily_invite_cap ?? "—"}</td>
                    <td className="small subtle">
                      {c.launched_at ? <time dateTime={isoAttr(c.launched_at)}>{when(c.launched_at)}</time> : "never"}
                    </td>
                    <td>
                      {c.status === "running" ? (
                        <ControlButton op="campaign-pause" fields={{ campaignId: c.id }} back={back} label="Pause" tone="ghost" />
                      ) : c.status === "paused" && c.launched_at ? (
                        <ControlButton op="campaign-resume" fields={{ campaignId: c.id }} back={back} label="Resume" tone="ghost" />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Model spend">
        <div className="grid grid-4">
          <Stat label="Total" value={formatUsd(totalSpend)} />
          <Stat label="Calls" value={String(callCount)} />
          <Stat label="Failed" value={String(failedCalls ?? 0)} />
          <Stat label="Unpriced" value={String(unpriced)} />
        </div>
        {unpriced ? (
          <p className="tiny subtle">
            {unpriced} call{unpriced === 1 ? "" : "s"} used a model missing from the price table, so
            {unpriced === 1 ? " it is" : " they are"} excluded rather than counted as zero.
          </p>
        ) : null}
      </Section>

      <Section title="Recent activity">
        {!events?.length ? (
          <p className="small muted">Nothing recorded yet.</p>
        ) : (
          <ul className="bullets">
            {events.map((e) => (
              <li key={e.id} className="small">
                <span className="mono">{e.name}</span>{" "}
                <time className="subtle" dateTime={isoAttr(e.created_at)}>
                  {when(e.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Section>
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
