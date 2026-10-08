import Link from "next/link";
import { funnelReport, isReadyToSend } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { SetupChecklist } from "@/components/setup-checklist";
import { NextStep } from "@/components/next-step";
import { NeedsYou } from "@/components/needs-you";
import { loadNeedsYou } from "@/lib/needs-you-data";
import { PageHeader, PageGroup, Section, Empty } from "@/components/page";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { readStrategyState } from "@/lib/strategy-state";
import { readSetupState } from "@/lib/setup-state";
import { readFunnelData } from "@/lib/funnel-data";
import { StrategyStatus } from "@/components/strategy-status";
import { TeamPanel } from "@/components/team-panel";
import type { TeamFacts } from "@/lib/team";

import { DailyReportSection } from "./report-section";
import { LimitsSection } from "./limits-section";
import { ResultsSection } from "./analytics-section";
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

  const [{ state: setup, next }, funnel, { data: profiles }, { count: prospectsFound }, { data: me }] = await Promise.all([
    readSetupState(supabase, session.workspaceId),
    readFunnelData(supabase, session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority, approved_at, do_not_pursue")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    // A count, not the rows: the team panel needs how many people Scout has
    // found, and nothing about any of them.
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId),
    // For the greeting: "Morning" at four in the afternoon is a small thing
    // that tells somebody the product does not know where they are.
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);

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
  const { items: needs, facts: needsFacts } = await loadNeedsYou(supabase, session.workspaceId);
  const waiting = needsFacts.heldReplies + needsFacts.heldBookings + needsFacts.heldForCopy;

  const report = funnelReport(funnel.rows, funnel.goals);
  const byProfile = new Map<string, number>();
  for (const campaign of funnel.campaigns) {
    if (!campaign.customer_profile_id) continue;
    const rows = funnel.rowsByCampaign.get(campaign.id)?.length ?? 0;
    byProfile.set(campaign.customer_profile_id, (byProfile.get(campaign.customer_profile_id) ?? 0) + rows);
  }

  // The team panel's facts, every one already on this page except the count
  // above. Pursued strategies only: one marked "not pursuing" is neither
  // waiting for approval nor something Scout will search.
  const pursued = (profiles ?? []).filter((profile) => !profile.do_not_pursue);
  const team: TeamFacts = {
    strategyPhase: strategy.phase,
    strategiesApproved: pursued.filter((profile) => profile.approved_at).length,
    strategiesAwaiting: pursued.filter((profile) => !profile.approved_at).length,
    prospectsFound: prospectsFound ?? 0,
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
      {/*
        No "All results" action: Results is a section further down this page,
        and /app/analytics only redirects back here — a button that reloads the
        screen you are on reads as a button that did nothing.
      */}
      <PageHeader
        title={session.fullName ? `${greeting(me?.timezone)}, ${session.fullName.split(" ")[0]}.` : "Overview"}
        lede="What needs you, and whether yesterday's sending worked."
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
      */}
      {next ? (
        <PageGroup id="setup">
          <NextStep step={next} ready={isReadyToSend(setup)} />
          <StrategyStatus state={strategy} />
          <SetupChecklist state={setup} />
        </PageGroup>
      ) : null}

      {/*
        Who is doing what, under the list of what needs you rather than above
        it: the list is the work, and this is the reassurance that everything
        not on it is in hand — or, where a teammate is stopped, the reason.
      */}
      <TeamPanel facts={team} />

      {/*
        A summary, and a link — not a second analytics page.
        The dashboard and Reporting each used to compute the same five numbers
        from their own query, which is two readings of one set of facts, and
        two readings drift. Four figures here answer "is it working"; every
        other number lives on Results.
      */}
      {/* First, above every chart. The funnel answers "how is it going",
          which is a question about the month; this answers "what happened",
          which is the question a person actually arrives with. */}
      <DailyReportSection />

      {/*
        The guardrails, on the screen somebody opens daily.

        Every advantage this product has over the category lives in caps, a
        ramp, a backoff and a spread — and all of it is invisible unless it
        fails. A customer who cannot see the guardrails has no way to tell this
        apart from the tool that got them restricted, which is the one thing
        they are actually afraid of.
      */}
      <LimitsSection />

      {/*
        "How it is going" used to sit here: four tiles, three of which repeated
        "This week" in Results below (the same invited count, and acceptance
        and reply as counts beside the same figures as rates), with a button to
        a Results page that redirects back to this one. Results is the one
        reading of those numbers now.
      */}

      <Section
        id="strategies"
        title="Strategies"
        description="Nothing is searched for until one is approved. A fit score only means something against the strategy that produced it."
        action={
          <Link href="/app/strategy" className="btn secondary small">
            Review and approve
          </Link>
        }
      >
        {profiles?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th className="num">Priority</th>
                  <th className="num">Prospects</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.name}</td>
                    <td className="num">{profile.priority}</td>
                    <td className="num">
                      {/* What it has actually produced, which is the only way
                          to tell an approved strategy that is working from one
                          that has never been given a campaign. */}
                      {(byProfile.get(profile.id) ?? 0).toLocaleString()}
                    </td>
                    <td>
                      {profile.do_not_pursue ? (
                        <span className="pill">Not pursuing</span>
                      ) : profile.approved_at ? (
                        <span className="pill positive">Approved</span>
                      ) : (
                        <span className="pill warning">Needs review</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No strategies yet." action="Ask Sage for strategies" href="/app/strategy">
            Sage, your strategist, reads your site and writes who to go after. Your business profile and
            its first customer profiles appear here when it finishes.
          </Empty>
        )}
      </Section>

      {/*
        Results and spend, on the screen somebody already lands on.
        They were two more tabs carrying two more readings of numbers this page
        already had, and "is this working" should not require knowing which of
        three screens to open. The anchors keep the old links working.
      */}
      <PageGroup id="results">
        <ResultsSection />
      </PageGroup>
    </>
  );
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
