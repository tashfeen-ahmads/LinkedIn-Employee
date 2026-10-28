import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, statsByWorkspace, when, type WorkspaceStats } from "@/lib/admin";
import { formatSpend } from "@/lib/spend-display";
import { countersForToday } from "@/lib/account-day";
import type { AccountRecord } from "@le/linkedin";
import { isoAttr } from "@/lib/format";
import { label as statusLabel } from "@/lib/labels";
import { dailyInviteCap } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";
import { Empty, PageHeader, Section } from "@/components/page";
import { Kpi } from "@/components/charts";
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
  // Read on its own, so the page still opens on a database that has not had
  // migration 0062 yet; unreadable reads as shown.
  const { data: visibility } = await supabase.from("workspaces").select("console_hidden").eq("id", id).maybeSingle();
  const consoleHidden = visibility?.console_hidden === true;

  // The fake database throws on embedded joins and PostgREST cannot be relied
  // on to shape them the same way, so memberships and profiles are fetched
  // separately and joined here. Same pattern as digest.ts.
  const [{ data: members }, { data: accounts }, { data: campaigns }, { data: stats }, { data: spend }, { data: events }] =
    await Promise.all([
      supabase.from("memberships").select("id, user_id, role, created_at").eq("workspace_id", id),
      supabase
        .from("linkedin_accounts")
        .select("id, user_id, display_name, status, status_detail, provider_account_id, created_at, has_sales_navigator, invites_today, invites_this_week, invites_by_day, messages_today, counters_reset_on, connected_at, first_action_at, last_action_at, invites_paused_until")
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
        crumbs={[{ href: "/admin/workspaces", label: "Workspaces" }]}
        title={workspace.name}
        lede={
          <span className="mono tiny subtle">
            {workspace.slug}
            {consoleHidden ? " · hidden from console lists" : ""}
          </span>
        }
        actions={
          <>
            {/* Owners only (the worker checks too): for the platform's own test
                and demo workspaces, which otherwise sit in every list beside
                paying customers. */}
            <ControlButton
              op="workspace-console-hidden"
              fields={{ workspaceId: id, on: consoleHidden ? "false" : "true" }}
              back={consoleHidden ? back : "/admin/workspaces"}
              label={consoleHidden ? "Show in console again" : "Hide from console"}
              tone="ghost"
              confirm={consoleHidden ? undefined : `Hide ${workspace.name} from every admin`}
              pendingLabel="Saving…"
            />
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
          </>
        }
      />
      <PageNotice error={notice.error} notice={notice.notice} />

      {/* The plan as the send path reads it (rule 67): free for good, a
          trial with its end, or a paid plan with its Stripe status. */}
      <Section title="Workspace">
        <div className="kpi-row">
          <Kpi label="Signed up" value={when(workspace.created_at)} />
          <Kpi
            label="Plan"
            value={planLabel(workspace.plan)}
            note={
              workspace.plan === "trial"
                ? workspace.trial_ends_at
                  ? `trial ends ${when(workspace.trial_ends_at)}`
                  : "trial with no end date"
                : workspace.subscription_status
                  ? `${workspace.subscription_status}${workspace.current_period_end ? `, renews ${when(workspace.current_period_end)}` : ""}`
                  : workspace.plan === "free"
                    ? "joined before pricing, keeps everything"
                    : "no subscription on record"
            }
          />
          <Kpi label="Open support tickets" value={String(openTickets ?? 0)} />
        </div>
        {openTickets ? (
          <p className="small">
            <Link href="/admin/support">Open the Support tab</Link>
          </p>
        ) : null}
      </Section>

      <Section title="People">
        {!members?.length ? (
          <Empty title="No members.">This workspace cannot be used by anyone.</Empty>
        ) : (
          <div className="table-scroll card-rows">
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
                  // Rolled over to this person's today, as the worker does.
                  const counts = a ? countersForToday(a as unknown as AccountRecord, p?.timezone ?? "UTC") : null;
                  return (
                    <tr key={m.id}>
                      <td data-label="Person">
                        <span className="small">{p?.full_name ?? "—"}</span>
                        <p className="tiny subtle">{p?.email ?? "—"}</p>
                      </td>
                      <td data-label="Role" className="small">{statusLabel(m.role)}</td>
                      <td data-label="LinkedIn">
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
                      <td data-label="Today" className="num mono">{counts ? counts.invites_today : "—"}</td>
                      <td data-label="This week" className="num mono">{counts ? counts.invites_this_week : "—"}</td>
                      <td data-label="Cap" className="small subtle">
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
        <div className="kpi-row">
          <Kpi label="Prospects" value={String(s?.prospects ?? 0)} />
          <Kpi label="Messages sent" value={String(s?.messages_sent ?? 0)} />
          <Kpi label="Conversations" value={String(s?.conversations ?? 0)} />
          <Kpi label="Waiting for a human" value={String(s?.pending_drafts ?? 0)} />
        </div>
        <p className="tiny subtle">
          Counts only. The rows behind these are the workspace&rsquo;s own customers&rsquo; data and are not
          readable from here.
        </p>
      </Section>

      <Section title="Campaigns">
        {!campaigns?.length ? (
          <Empty title="No campaigns yet.">One is built once this workspace approves a strategy and its search finds people.</Empty>
        ) : (
          <div className="table-scroll card-rows">
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
                    <td data-label="Name" className="small">{c.name}</td>
                    <td data-label="Status">
                      <span className={`pill tiny ${c.status === "running" ? "positive" : "plain"}`}>{statusLabel(c.status)}</span>
                    </td>
                    <td data-label="Replies" className="small">{c.reply_mode}</td>
                    <td data-label="Cap" className="num mono">{c.daily_invite_cap ?? "—"}</td>
                    <td data-label="Launched" className="small subtle">
                      {c.launched_at ? <time dateTime={isoAttr(c.launched_at)}>{when(c.launched_at)}</time> : "never"}
                    </td>
                    <td data-label="Actions">
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
        <div className="kpi-row">
          <Kpi label="Total" value={formatSpend(totalSpend, callCount, unpriced)} />
          <Kpi label="Calls" value={String(callCount)} />
          <Kpi label="Failed" value={String(failedCalls ?? 0)} />
          <Kpi label="Unpriced" value={String(unpriced)} />
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
          <Empty title="Nothing recorded yet.">Events appear here as this workspace is used.</Empty>
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

function planLabel(plan: string): string {
  switch (plan) {
    case "free":
      return "Free";
    case "trial":
      return "Trial";
    case "autopilot":
      return "Autopilot";
    case "canceled":
      return "Cancelled";
    default:
      return "Pro";
  }
}

