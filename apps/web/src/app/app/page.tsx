import Link from "next/link";
import { funnelReport, isReadyToSend, nextRequiredStep, ONBOARDING_STEPS } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { SetupChecklist } from "@/components/setup-checklist";
import { NextStep } from "@/components/next-step";
import { NeedsYou } from "@/components/needs-you";
import { loadNeedsYou } from "@/lib/needs-you-data";
import { PageHeader, PageGroup } from "@/components/page";
import { createClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/rows";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { readStrategyState } from "@/lib/strategy-state";
import { readSetupState } from "@/lib/setup-state";
import { readFunnelData } from "@/lib/funnel-data";
import { canSeeTeamFunnel, scopeFunnel } from "@/lib/funnel-scope";
import { StrategyStatus } from "@/components/strategy-status";
import { TeamPanel } from "@/components/team-panel";
import type { TeamFacts } from "@/lib/team";

import { DailyReportSection } from "./report-section";
import { AccountSafety } from "./limits-section";
import { HeadlineStats } from "./analytics-section";
import { workspaceUsesOwnBookingLink } from "@/lib/booking-link";
/**
 * The morning screen: what to do, and whether what was done is working.
 *
 * It used to compute the setup state itself — a second reading of the seven
 * facts `readSetupState` computes for the sidebar, which had already drifted
 * (this page counted a connected calendar as a step; that reading did not). Two
 * readings of one rule always end up disagreeing, and the one somebody believes
 * is whichever they happened to look at. Rule 32 says one voice; this is it.
 */
export default async function OverviewPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ state: setup }, everything, { data: profiles }, { rows: found }, { data: me }, { data: account }] = await Promise.all([
    readSetupState(supabase, session.workspaceId),
    readFunnelData(supabase, session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority, approved_at, do_not_pursue")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    // Which strategy found each person, and nothing else about them: the team
    // panel needs how many Scout has found. Counted from `prospects` by
    // `customer_profile_id`, the same reading the Strategy page and the
    // Prospects tabs make (rules 26 and 32). Paged, because a plain select
    // stops at a thousand rows without saying so.
    fetchAllRows<{ customer_profile_id: string | null }>((from, to) =>
      supabase
        .from("prospects")
        .select("customer_profile_id")
        .eq("workspace_id", session.workspaceId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // For the greeting: "Morning" at four in the afternoon is a small thing
    // that tells somebody the product does not know where they are.
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    // Whether this person's searches run on Sales Navigator, for the strip
    // that offers it. Their own row only: a teammate's seat is theirs to say.
    supabase
      .from("linkedin_accounts")
      .select("status, has_sales_navigator")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);

  // Setup, and only the steps that stop anything being sent. The optional
  // knowledge step is a prompt of its own once those are done.
  const required = nextRequiredStep(setup);
  const knowledge = !required && !setup.hasKnowledge ? ONBOARDING_STEPS.find((step) => step.key === "hasKnowledge") : undefined;

  // The Strategy Agent's own progress, which is a different question from
  // "which step is this workspace on" and has its own panel.
  const strategy = await readStrategyState(supabase, session.workspaceId, setup.hasBusinessProfile);

  /*
   * What needs a person, from the one function the nav also reads.
   *
   * This page used to count `reply_drafts` with `status = "pending"` — which is
   * not what the inbox lists. Rule 10 is explicit that a conversation can be
   * flagged with no draft at all, so a held conversation with nothing drafted
   * was shown in the inbox and counted by neither this screen nor the sidebar
   * badge. Two readings of one question, and the one somebody believes is
   * whichever they looked at.
   */
  const { items: needs, facts: needsFacts } = await loadNeedsYou(supabase, session.workspaceId, new Date(), session.userId);
  const waiting = needsFacts.heldReplies + needsFacts.heldBookings + needsFacts.heldForCopy;

  /*
   * Scoped once, before anything is counted, exactly as Results below scopes
   * it. The headline figures used to count the whole workspace for a rep while
   * Results under them counted only the rep's campaigns, so "Invited, last 7
   * days" and the funnel a few inches lower disagreed on the same screen.
   */
  const funnel = scopeFunnel(everything, {
    userId: session.userId,
    canSeeTeam: canSeeTeamFunnel(session.role),
  });
  const report = funnelReport(funnel.rows, funnel.goals, Date.now());
  // Whether the Meetings figure below can be the whole story (rule 31). Only
  // asked when that figure is shown at all.
  const ownBookingLink =
    report.stages.some((stage) => stage.key === "meetings") &&
    (await workspaceUsesOwnBookingLink(supabase, session.workspaceId));
  // The team panel's facts, every one already on this page except the count
  // above. Pursued strategies only: one marked "not pursuing" is neither
  // waiting for approval nor something Scout will search.
  const pursued = (profiles ?? []).filter((profile) => !profile.do_not_pursue);
  const team: TeamFacts = {
    strategyPhase: strategy.phase,
    strategiesApproved: pursued.filter((profile) => profile.approved_at).length,
    strategiesAwaiting: pursued.filter((profile) => !profile.approved_at).length,
    prospectsFound: found.length,
    campaignsTotal: funnel.campaigns.filter((campaign) => campaign.status !== "archived").length,
    campaignsRunning: funnel.campaigns.filter((campaign) => campaign.status === "running").length,
    campaignsDraft: funnel.campaigns.filter((campaign) => campaign.status === "draft").length,
    invited: report.counts.invited,
    replied: report.counts.replied,
    meetings: report.counts.meetings,
    meetingsCounted: report.stages.some((stage) => stage.key === "meetings"),
    heldReplies: needsFacts.heldReplies,
    linkedInConnected: needsFacts.linkedInConnected,
    needsYou: needs.length,
  };

  return (
    <>
      <PageHeader
        title={session.fullName ? `${greeting(me?.timezone)}, ${session.fullName.split(" ")[0]}` : "Overview"}
        lede={statusLine(team, waiting)}
      />
      <PageNotice error={params.error} notice={params.notice} />

      {/*
        Q1, and nothing above it.
        "What is stopped until I do something" is the question somebody arrives
        with, and it used to be spread across a next-step card, a strategy
        panel, a checklist, a counter and a table. A screen where five things
        have equal weight answers nothing.
      */}
      <NeedsYou items={needs} />

      {/*
        Onboarding, and only while there is onboarding left.

        These three were unconditional, so a workspace that finished setting up
        in September still opened every morning to a next-step card saying
        "everything is connected", a strategy panel and a six-item checklist of
        ticks — three sections of congratulation above the work. That is most of
        how the overview came to have eight things on it competing for one
        person's attention.

        A workspace mid-setup still gets the full instruction, which is the case
        they were written for. A finished one gets Q1, Q2, Q3 and nothing else.

        "Mid-setup" means a required step outstanding (`nextRequiredStep`). The
        knowledge base is optional, so keying the block on `nextStep` showed the
        whole of it, checklist and all, for ever to every workspace that never
        filled one in. It gets one line of its own instead.
      */}
      {required ? (
        <PageGroup id="setup">
          <NextStep step={required} ready={isReadyToSend(setup)} />
          <StrategyStatus state={strategy} />
          <SetupChecklist state={setup} />
        </PageGroup>
      ) : knowledge ? (
        <div className="notice">
          <p className="small">
            {knowledge.why}{" "}
            <Link href={knowledge.href}>{knowledge.action}</Link>
          </p>
        </div>
      ) : null}

      {/*
        Is it working: four totals in plain words, and a link to every chart
        on Results. The Sales Navigator question is asked once, on
        onboarding's LinkedIn step, and kept on the profile.
      */}
      <HeadlineStats report={report} ownBookingLink={ownBookingLink} />

      {/*
        What happened today beside how close today is to the limits. Two short
        panels on one row rather than two panels of meters, a fourteen-day
        chart and the day's story stacked down the page. The guardrails stay
        on the screen somebody opens daily (rule 51); the full set of meters
        and the chart are on Results.
      */}
      <div className="overview-pair overview-today">
        <DailyReportSection />
        <AccountSafety />
      </div>

      {/*
        Who is doing what, last: the list at the top is the work, and this is
        the reassurance that everything not on it is in hand, or, where a
        teammate is stopped, the reason.
      */}
      <TeamPanel facts={team} />
    </>
  );
}

/**
 * One status line under the greeting, from facts the page already has: what is
 * running and what is waiting. Never a promise about the next send, which only
 * the campaign page can make, because only it asks the limiter.
 */
function statusLine(team: TeamFacts, waiting: number): string {
  const parts: string[] = [];
  if (team.campaignsRunning > 0) {
    parts.push(`${team.campaignsRunning} ${team.campaignsRunning === 1 ? "campaign" : "campaigns"} running.`);
  } else if (team.campaignsDraft > 0) {
    parts.push(
      `${team.campaignsDraft} ${team.campaignsDraft === 1 ? "campaign is" : "campaigns are"} waiting for launch, and nothing is sending yet.`,
    );
  } else {
    parts.push("No campaign is running yet.");
  }
  if (waiting > 0) {
    parts.push(`${waiting} ${waiting === 1 ? "conversation is" : "conversations are"} waiting in your inbox.`);
  }
  return parts.join(" ");
}

/**
 * Good morning, afternoon or evening, in the rep's own timezone.
 *
 * It said "Morning" at any hour. Without a timezone we cannot know which part
 * of their day it is, so it says something true at every hour instead.
 */
function greeting(timezone: string | null | undefined): string {
  if (!timezone) return "Welcome back";
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date()),
    );
  } catch {
    return "Welcome back";
  }
  if (!Number.isFinite(hour)) return "Welcome back";
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}
