import Link from "next/link";
import { BOOT_BEAT, PACING_LOOP, PACING_STALE_MS } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago, formatUsd } from "@/lib/admin";
import { callWorker } from "@/lib/worker";
import { PageHeader, Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { Kpi } from "@/components/charts";
import { ControlButton } from "@/components/admin-control";

export const dynamic = "force-dynamic";

type Issue = { severity: "critical" | "warning" | "info" };

/**
 * The whole deployment on one screen, and the controls that matter most.
 *
 * The question an operator opens the console with is "is anything stuck, and
 * is it mine to fix" — so the first thing on the page is the list of what is
 * waiting on them, each row linking to the tab where it is fixed, then the
 * numbers, then the switches.
 */
export default async function AdminOverviewPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const admin = await requirePlatformAdmin();
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [
    { data: workspaces },
    { data: users },
    { data: accounts },
    { data: campaigns },
    { data: tickets },
    { data: settings },
    { data: beats },
    { data: spend },
    issues,
  ] = await Promise.all([
    supabase.from("workspaces").select("id, created_at"),
    supabase.rpc("platform_users"),
    supabase.from("linkedin_accounts").select("id, status, invites_today, messages_today, invites_paused_until"),
    supabase.from("campaigns").select("id, status"),
    supabase.from("support_tickets").select("id, status, answered_by, drafted_at, created_at"),
    supabase.from("platform_settings").select("outreach_paused_at, outreach_paused_reason, support_autopilot").maybeSingle(),
    supabase.from("worker_heartbeats").select("name, beat_at, detail").in("name", [PACING_LOOP, BOOT_BEAT]),
    supabase.rpc("platform_spend_breakdown", { p_days: 7 }),
    callWorker<{ issues: Issue[] }>("/admin/issues", { userId: admin.userId }),
  ]);

  const pacing = (beats ?? []).find((b) => b.name === PACING_LOOP);
  const boot = (beats ?? []).find((b) => b.name === BOOT_BEAT);
  const loopFresh = pacing?.beat_at ? Date.now() - Date.parse(pacing.beat_at) <= PACING_STALE_MS : false;
  const bootDetail = (boot?.detail ?? {}) as { commit?: string | null; queueReachable?: boolean };

  const allIssues = issues.ok ? (issues.data?.issues ?? []) : [];
  const critical = allIssues.filter((i) => i.severity === "critical").length;
  const warnings = allIssues.filter((i) => i.severity === "warning").length;

  const open = (tickets ?? []).filter((t) => t.status === "open");
  const heldForYou = open.filter((t) => t.drafted_at).length;
  const assistantWeek = (tickets ?? []).filter((t) => t.answered_by === "agent" && t.created_at >= weekAgo).length;

  const notSending = (accounts ?? []).filter((a) => a.status !== "active").length;
  const held = (accounts ?? []).filter(
    (a) => a.invites_paused_until && Date.parse(a.invites_paused_until) > Date.now(),
  ).length;
  const invitesToday = (accounts ?? []).reduce((sum, a) => sum + (a.invites_today ?? 0), 0);
  const messagesToday = (accounts ?? []).reduce((sum, a) => sum + (a.messages_today ?? 0), 0);
  const running = (campaigns ?? []).filter((c) => c.status === "running").length;
  const drafts = (campaigns ?? []).filter((c) => c.status === "draft").length;
  const spendWeek = (spend ?? []).reduce((sum, row) => sum + Number(row.spend_usd), 0);
  const newWeek = (users ?? []).filter((u) => u.created_at >= weekAgo).length;
  const signedInWeek = (users ?? []).filter((u) => u.last_sign_in_at && u.last_sign_in_at >= weekAgo).length;

  /*
   * What is waiting on an operator, in the order it costs somebody. Nothing is
   * dropped for being less urgent than something else — a list that hides a
   * row because a worse row exists is how a ticket waits four days.
   */
  const waiting: Array<{ tone: "danger" | "warning"; text: string; href: string }> = [];
  if (settings?.outreach_paused_at) {
    waiting.push({ tone: "danger", text: `Outreach is paused for every account (${ago(settings.outreach_paused_at)}).`, href: "/admin/settings" });
  }
  if (!loopFresh) waiting.push({ tone: "danger", text: "The sending loop has not run in the last 15 minutes.", href: "/admin/jobs" });
  if (bootDetail.queueReachable === false) waiting.push({ tone: "danger", text: "The worker cannot reach its job queue.", href: "/admin/jobs" });
  if (critical) waiting.push({ tone: "danger", text: `${critical} critical issue${critical === 1 ? "" : "s"}.`, href: "/admin/issues" });
  if (heldForYou) {
    waiting.push({ tone: "warning", text: `${heldForYou} support ticket${heldForYou === 1 ? "" : "s"} drafted and waiting for you.`, href: "/admin/support" });
  }
  if (notSending) {
    waiting.push({ tone: "warning", text: `${notSending} LinkedIn account${notSending === 1 ? " is" : "s are"} not active.`, href: "/admin/accounts" });
  }
  if (warnings) waiting.push({ tone: "warning", text: `${warnings} warning${warnings === 1 ? "" : "s"} on the Issues list.`, href: "/admin/issues" });

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <PageHeader
        eyebrow="Operator"
        title="Overview"
        lede="Everything on the platform, what is waiting on you, and the switches that control it."
      />

      <Section title="Waiting on you">
        {waiting.length === 0 ? (
          <div className="notice positive">
            <p>Nothing. The loop is running, no ticket is waiting, and no account or issue needs you.</p>
          </div>
        ) : (
          <ul className="stack-2">
            {waiting.map((row) => (
              <li key={row.text} className="between">
                <span className="cluster">
                  <span className={`pill tiny ${row.tone}`}>{row.tone === "danger" ? "Now" : "Soon"}</span>
                  <span className="small">{row.text}</span>
                </span>
                <Link className="small" href={row.href}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Platform">
        <div className="kpi-row">
          <Kpi label="Workspaces" value={String(workspaces?.length ?? 0)} note={`${users?.length ?? 0} people · ${newWeek} new this week`} />
          <Kpi label="Signed in this week" value={String(signedInWeek)} note="people, any workspace" />
          <Kpi label="Running campaigns" value={String(running)} note={`${drafts} still in draft`} />
          <Kpi
            label="Sent today"
            value={String(invitesToday + messagesToday)}
            note={`${invitesToday} invitations · ${messagesToday} messages`}
          />
          <Kpi
            label="LinkedIn accounts"
            value={String(accounts?.length ?? 0)}
            note={`${notSending} not active · ${held} held by LinkedIn`}
            tone={notSending ? "warning" : "neutral"}
          />
          <Kpi label="Support" value={String(open.length)} note={`open · ${assistantWeek} answered by the assistant this week`} />
          <Kpi label="AI spend, 7 days" value={formatUsd(spendWeek)} note={<Link href="/admin/spend">by agent and model</Link>} />
        </div>
      </Section>

      <Section title="Health">
        <div className="table-scroll">
          <table>
            <tbody>
              <tr>
                <th>Sending loop</th>
                <td>
                  <span className={`pill tiny ${loopFresh ? "positive" : "danger"}`}>{loopFresh ? "running" : "stopped"}</span>
                </td>
                <td className="small subtle">last run {ago(pacing?.beat_at)}</td>
              </tr>
              <tr>
                <th>Worker</th>
                <td>
                  <span className={`pill tiny ${bootDetail.queueReachable === false ? "danger" : "positive"}`}>
                    {bootDetail.queueReachable === false ? "queue unreachable" : "up"}
                  </span>
                </td>
                <td className="small subtle">
                  started {ago(boot?.beat_at)} on <span className="mono">{bootDetail.commit?.slice(0, 7) ?? "unknown build"}</span>
                </td>
              </tr>
              <tr>
                <th>Issues</th>
                <td>
                  <span className={`pill tiny ${critical ? "danger" : warnings ? "warning" : "positive"}`}>
                    {issues.ok ? `${critical} critical · ${warnings} warning` : "could not check"}
                  </span>
                </td>
                <td className="small subtle">{issues.ok ? "" : issues.error}</td>
              </tr>
              <tr>
                <th>Support autopilot</th>
                <td>
                  <span className={`pill tiny ${settings?.support_autopilot === false ? "plain" : "positive"}`}>
                    {settings?.support_autopilot === false ? "off" : "on"}
                  </span>
                </td>
                <td className="small subtle">
                  {settings?.support_autopilot === false ? "every answer waits for you" : "confident answers are sent; the rest wait for you"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Quick controls" description="Each one runs on the worker and says what it did. More on Jobs and Settings.">
        <div className="cluster">
          <ControlButton op="run-task" fields={{ task: "tick" }} back="/admin" label="Run the sending loop now" />
          <ControlButton op="run-task" fields={{ task: "acceptance" }} back="/admin" label="Check acceptances now" />
          <ControlButton op="run-task" fields={{ task: "inbound-poll" }} back="/admin" label="Check for replies now" />
          <ControlButton op="support-sweep" back="/admin" label="Answer open tickets now" pendingLabel="Answering…" />
          <ControlButton op="accounts-recover" back="/admin" label="Re-check LinkedIn accounts" pendingLabel="Checking…" />
          {settings?.outreach_paused_at ? (
            <ControlButton op="outreach-resume" back="/admin" label="Resume all outreach" tone="primary" />
          ) : (
            <Link className="btn small danger" href="/admin/settings">
              Pause all outreach…
            </Link>
          )}
        </div>
      </Section>
    </>
  );
}
