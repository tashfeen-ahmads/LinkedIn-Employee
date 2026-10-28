import Link from "next/link";
import { NavIcon } from "@/components/icons";
import { BOOT_BEAT, PACING_LOOP, PACING_STALE_MS, isIdleReleased } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago, hiddenWorkspaces, shown, shownUserIds } from "@/lib/admin";
import { formatSpend } from "@/lib/spend-display";
import { countersForToday } from "@/lib/account-day";
import type { AccountRecord } from "@le/linkedin";
import { ISSUES_TIMEOUT_MS, callWorker } from "@/lib/worker";
import { PageHeader, Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { ControlButton } from "@/components/admin-control";

export const dynamic = "force-dynamic";

/** The sidebar's own picture for each page a waiting row opens. */
const DESTINATION_ICON: Record<string, string> = {
  "/admin/settings": "shield",
  "/admin/jobs": "agents",
  "/admin/issues": "system",
  "/admin/support": "support",
  "/admin/accounts": "prospects",
};

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
  // Workspaces an owner hid from the console are left out of every count here.
  const hidden = await hiddenWorkspaces();
  const notHiddenEvents = <Q extends { or: (filter: string) => Q }>(query: Q): Q =>
    hidden.size ? query.or(`workspace_id.is.null,workspace_id.not.in.(${[...hidden].join(",")})`) : query;

  const [
    { data: allWorkspaces },
    { data: allUsers },
    { data: allAccounts },
    { data: allCampaigns },
    { data: allTickets },
    { data: settings },
    { data: zones },
    { data: beats },
    { data: spend },
    issues,
    { count: repliesWeek },
    { count: meetingsWeek },
    { data: memberships },
  ] = await Promise.all([
    supabase.from("workspaces").select("id, created_at"),
    supabase.rpc("platform_users"),
    supabase
      .from("linkedin_accounts")
      .select("id, workspace_id, user_id, status, status_detail, provider_account_id, invites_today, messages_today, counters_reset_on, invites_paused_until"),
    supabase.from("campaigns").select("id, workspace_id, status"),
    supabase.from("support_tickets").select("id, workspace_id, status, answered_by, drafted_at, created_at"),
    supabase.from("platform_settings").select("outreach_paused_at, outreach_paused_reason, support_autopilot").maybeSingle(),
    supabase.from("profiles").select("id, timezone"),
    supabase.from("worker_heartbeats").select("name, beat_at, detail").in("name", [PACING_LOOP, BOOT_BEAT]),
    supabase.rpc("platform_spend_breakdown", { p_days: 7 }),
    callWorker<{ issues: Issue[] }>("/admin/issues", { userId: admin.userId }, ISSUES_TIMEOUT_MS),
    notHiddenEvents(supabase.from("events").select("id", { count: "exact", head: true }).eq("name", "message.received").gte("created_at", weekAgo)),
    notHiddenEvents(supabase.from("events").select("id", { count: "exact", head: true }).eq("name", "meeting.booked").gte("created_at", weekAgo)),
    supabase.from("memberships").select("workspace_id, user_id"),
  ]);
  const workspaces = shown(allWorkspaces, hidden, "id");
  const accounts = shown(allAccounts, hidden);
  const campaigns = shown(allCampaigns, hidden);
  const tickets = shown(allTickets, hidden);
  const userShown = shownUserIds(memberships, hidden);
  const users = (allUsers ?? []).filter((u) => userShown(u.user_id));

  const pacing = (beats ?? []).find((b) => b.name === PACING_LOOP);
  const boot = (beats ?? []).find((b) => b.name === BOOT_BEAT);
  const loopFresh = pacing?.beat_at ? Date.now() - Date.parse(pacing.beat_at) <= PACING_STALE_MS : false;
  const bootDetail = (boot?.detail ?? {}) as { commit?: string | null; queueReachable?: boolean };

  // A list that could not be read is not an empty list. Counted as zero, it
  // turned "Waiting on you" into "Nothing" and the Issues pill green beside the
  // words "could not check" (rule 17's disease, on the operator's own screen).
  const issuesRead = issues.ok && Array.isArray(issues.data?.issues);
  const allIssues = issuesRead ? (issues.data?.issues ?? []) : [];
  const critical = allIssues.filter((i) => i.severity === "critical").length;
  const warnings = allIssues.filter((i) => i.severity === "warning").length;

  const open = (tickets ?? []).filter((t) => t.status === "open");
  const heldForYou = open.filter((t) => t.drafted_at).length;
  const assistantWeek = (tickets ?? []).filter((t) => t.answered_by === "agent" && t.created_at >= weekAgo).length;

  // Only an account that was working and broke needs an operator. A sign-in
  // somebody started and never finished is the customer's step, not a fault
  // (rule 56), and an account released for being idle is waiting for its
  // owner to come back (rule 63). Counted as "not active", four customers who
  // had not finished connecting read as four broken accounts.
  const unfinished = (accounts ?? []).filter((a) => a.status === "connecting" && !a.provider_account_id).length;
  const notSending = (accounts ?? []).filter(
    (a) => a.status !== "active" && !(a.status === "connecting" && !a.provider_account_id) && !isIdleReleased(a),
  ).length;
  const held = (accounts ?? []).filter(
    (a) => a.invites_paused_until && Date.parse(a.invites_paused_until) > Date.now(),
  ).length;
  // Each account's counters rolled over to its owner's today, as the worker
  // does before its first send. Summed as stored, every idle account added
  // yesterday's sends to "Sent today".
  const zoneOf = new Map((zones ?? []).map((p) => [p.id, p.timezone ?? "UTC"]));
  const today = (accounts ?? []).map((a) =>
    countersForToday(a as unknown as AccountRecord, zoneOf.get(a.user_id) ?? "UTC"),
  );
  const invitesToday = today.reduce((sum, a) => sum + (a.invites_today ?? 0), 0);
  const messagesToday = today.reduce((sum, a) => sum + (a.messages_today ?? 0), 0);
  const running = (campaigns ?? []).filter((c) => c.status === "running").length;
  const drafts = (campaigns ?? []).filter((c) => c.status === "draft").length;
  const spendWeek = (spend ?? []).reduce((sum, row) => sum + Number(row.spend_usd), 0);
  const callsWeek = (spend ?? []).reduce((sum, row) => sum + Number(row.calls), 0);
  const unpricedWeek = (spend ?? []).reduce((sum, row) => sum + Number(row.unpriced), 0);
  const bootKnown = Boolean(boot?.beat_at);
  const newWeek = (users ?? []).filter((u) => u.created_at >= weekAgo).length;
  const signedInWeek = (users ?? []).filter((u) => u.last_sign_in_at && u.last_sign_in_at >= weekAgo).length;

  /*
   * What is waiting on an operator, in the order it costs somebody. Nothing is
   * dropped for being less urgent than something else — a list that hides a
   * row because a worse row exists is how a ticket waits four days.
   */
  const waiting: Array<{ tone: "danger" | "warning"; text: string; href: string }> = [];
  const destinations: Record<string, string> = {
    "/admin/settings": "Settings",
    "/admin/jobs": "Jobs",
    "/admin/issues": "Issues",
    "/admin/support": "Support",
    "/admin/accounts": "LinkedIn accounts",
  };
  if (settings?.outreach_paused_at) {
    waiting.push({ tone: "danger", text: `Outreach is paused for every account (${ago(settings.outreach_paused_at)}).`, href: "/admin/settings" });
  }
  if (!loopFresh) waiting.push({ tone: "danger", text: "The sending loop has not run in the last 15 minutes.", href: "/admin/jobs" });
  if (bootDetail.queueReachable === false) waiting.push({ tone: "danger", text: "The worker cannot reach its job queue.", href: "/admin/jobs" });
  const issuesWhy = issues.ok ? "the worker answered without a list" : issues.error;
  if (!issuesRead) {
    waiting.push({ tone: "danger", text: `The Issues list could not be read (${issuesWhy}), so nothing here can say the platform is clear.`, href: "/admin/issues" });
  }
  if (critical) waiting.push({ tone: "danger", text: `${critical} critical issue${critical === 1 ? "" : "s"}.`, href: "/admin/issues" });
  if (heldForYou) {
    waiting.push({ tone: "warning", text: `${heldForYou} support ticket${heldForYou === 1 ? "" : "s"} drafted and waiting for you.`, href: "/admin/support" });
  }
  if (notSending) {
    waiting.push({ tone: "warning", text: `${notSending} LinkedIn account${notSending === 1 ? " has" : "s have"} stopped working.`, href: "/admin/accounts" });
  }
  if (warnings) waiting.push({ tone: "warning", text: `${warnings} warning${warnings === 1 ? "" : "s"} on the Issues list.`, href: "/admin/issues" });

  return (
    <>
      <PageHeader
        title="Overview"
        lede="Everything on the platform, what is waiting on you, and the switches that control it."
      />
      <PageNotice error={params.error} notice={params.notice} />

      {/* The same queue the member overview leads with: one panel, one row per
          thing, the sentence and the button that clears it. A pill and a bare
          "Open" link made the most important block on the console read as a
          footnote. */}
      {waiting.length === 0 ? (
        <Section
          id="waiting"
          title="Nothing is waiting on you."
          description="The loop is running, no ticket is waiting, and no account or issue needs you."
          surface={{ className: "card needs-you-clear", eyebrow: "All clear" }}
        />
      ) : (
        <Section
          id="waiting"
          title="Waiting on you"
          surface={{
            className: "needs-you",
            headingClassName: "needs-you-heading",
            aside: <span className="needs-you-count">{waiting.length === 1 ? "1 thing" : `${waiting.length} things`}</span>,
          }}
        >
          <ul className="needs-you-list">
            {waiting.map((row) => (
              <li key={row.text} className={`needs-you-item ${row.tone === "danger" ? "blocker" : "warning"}`}>
                <span className="needs-you-icon" aria-hidden="true">
                  <NavIcon name={DESTINATION_ICON[row.href] ?? "dot"} />
                </span>
                <div className="needs-you-text">
                  <p className="needs-you-title">{row.text}</p>
                </div>
                <Link className={`btn small${row.tone === "danger" ? "" : " secondary"}`} href={row.href}>
                  Open {destinations[row.href] ?? "the page"}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Two rows of four, grouped by the question each answers, rather than
          seven equal cards with one left over. Every number names what it
          counts; the note under it is the breakdown, never a second claim. */}
      <Section title="Platform">
        <div className="console-stat-groups">
          <dl className="console-stats" aria-label="Customers">
            <Stat label="Workspaces" value={workspaces?.length ?? 0} note={`${users?.length ?? 0} people · ${newWeek} new this week`} />
            <Stat label="Signed in, 7 days" value={signedInWeek} note="people, any workspace" />
            <Stat label="Running campaigns" value={running} note={`${drafts} still in draft`} />
            <Stat label="Open tickets" value={open.length} note={`${assistantWeek} answered by the assistant this week`} tone={heldForYou ? "warning" : undefined} />
          </dl>
          <dl className="console-stats" aria-label="Sending">
            <Stat label="Sent today" value={invitesToday + messagesToday} note={`${invitesToday} invitations · ${messagesToday} messages`} />
            <Stat label="Replies, 7 days" value={repliesWeek ?? 0} note={`${meetingsWeek ?? 0} meetings booked`} />
            <Stat
              label="LinkedIn accounts"
              value={accounts?.length ?? 0}
              note={`${notSending} need attention · ${held} held by LinkedIn${unfinished ? ` · ${unfinished} never finished connecting` : ""}`}
              tone={notSending ? "warning" : undefined}
            />
            <Stat
              label="AI spend, 7 days"
              value={formatSpend(spendWeek, callsWeek, unpricedWeek)}
              note={<Link href="/admin/spend">{unpricedWeek ? `${unpricedWeek} unpriced calls, so a floor` : "by agent and model"}</Link>}
            />
          </dl>
        </div>
      </Section>

      <Section title="Health">
        <ul className="console-health">
          <HealthTile
            name="Sending loop"
            tone={loopFresh ? "positive" : "danger"}
            state={loopFresh ? "Running" : "Stopped"}
            detail={`Last run ${ago(pacing?.beat_at)}`}
          />
          {/* No boot stamp is unknown, never "up" (rule 23): it is also what a
              build that has not shipped the stamp looks like. */}
          <HealthTile
            name="Worker"
            tone={!bootKnown ? "plain" : bootDetail.queueReachable === false ? "danger" : "positive"}
            state={!bootKnown ? "Unknown" : bootDetail.queueReachable === false ? "Queue unreachable" : "Up"}
            detail={`Started ${ago(boot?.beat_at)} · build ${bootDetail.commit?.slice(0, 7) ?? "unknown"}`}
          />
          <HealthTile
            name="Issues"
            tone={!issuesRead || critical ? "danger" : warnings ? "warning" : "positive"}
            state={issuesRead ? (critical || warnings ? `${critical} critical · ${warnings} warning` : "None") : "Could not check"}
            detail={issues.ok ? "Across every workspace" : issues.error}
            href="/admin/issues"
          />
          <HealthTile
            name="Support autopilot"
            tone={settings?.support_autopilot === false ? "plain" : "positive"}
            state={settings?.support_autopilot === false ? "Off" : "On"}
            detail={settings?.support_autopilot === false ? "Every answer waits for you" : "Confident answers go out, the rest wait"}
            href="/admin/settings"
          />
        </ul>
      </Section>

      <Section title="Controls" description="Each runs on the worker straight away and says what it did.">
        <ul className="console-controls">
          <ControlRow name="Run the sending loop" detail="Places today's invitations and follow-ups now instead of at the next five-minute tick.">
            <ControlButton op="run-task" fields={{ task: "tick" }} back="/admin" label="Run now" />
          </ControlRow>
          <ControlRow name="Check acceptances" detail="Asks LinkedIn who accepted since the last hourly check.">
            <ControlButton op="run-task" fields={{ task: "acceptance" }} back="/admin" label="Check now" />
          </ControlRow>
          <ControlRow name="Check for replies" detail="Reads new messages on every account, as the fifteen-minute poll does.">
            <ControlButton op="run-task" fields={{ task: "inbound-poll" }} back="/admin" label="Check now" />
          </ControlRow>
          <ControlRow name="Answer open tickets" detail="Hands every open ticket to the support assistant.">
            <ControlButton op="support-sweep" back="/admin" label="Answer now" pendingLabel="Answering…" />
          </ControlRow>
          <ControlRow name="Re-check LinkedIn accounts" detail="Repairs accounts whose connection moved, before anyone notices.">
            <ControlButton op="accounts-recover" back="/admin" label="Re-check" pendingLabel="Checking…" />
          </ControlRow>
          <ControlRow
            name={settings?.outreach_paused_at ? "Outreach is paused" : "Pause all outreach"}
            detail={
              settings?.outreach_paused_at
                ? `Paused ${ago(settings.outreach_paused_at)}. Nothing is sending on any account.`
                : "Stops every invitation and follow-up on every account until resumed."
            }
            danger
          >
            {settings?.outreach_paused_at ? (
              <ControlButton
                op="outreach-resume"
                back="/admin"
                label="Resume all outreach"
                tone="primary"
                confirm="Resume every account's outreach"
                pendingLabel="Resuming…"
              />
            ) : (
              <Link className="btn small danger" href="/admin/settings">
                Pause…
              </Link>
            )}
          </ControlRow>
        </ul>
      </Section>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number | string;
  note: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <div className="console-stat">
      <dt>{label}</dt>
      <dd className={`console-stat-value${tone ? ` is-${tone}` : ""}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </dd>
      <dd className="console-stat-note">{note}</dd>
    </div>
  );
}

function HealthTile({
  name,
  tone,
  state,
  detail,
  href,
}: {
  name: string;
  tone: "positive" | "warning" | "danger" | "plain";
  state: string;
  detail: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="console-health-name">{name}</span>
      <span className={`pill tiny ${tone}`}>{state}</span>
      <span className="console-health-detail">{detail}</span>
    </>
  );
  return (
    <li className={`console-health-tile is-${tone}`}>
      {href ? (
        <Link href={href} className="console-health-link">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function ControlRow({
  name,
  detail,
  danger,
  children,
}: {
  name: string;
  detail: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={`console-control${danger ? " is-danger" : ""}`}>
      <div className="console-control-text">
        <p className="console-control-name">{name}</p>
        <p className="console-control-detail">{detail}</p>
      </div>
      {children}
    </li>
  );
}
