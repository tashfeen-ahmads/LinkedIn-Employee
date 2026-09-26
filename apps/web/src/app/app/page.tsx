import Link from "next/link";
import { funnelReport, isReadyToSend } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { SetupChecklist } from "@/components/setup-checklist";
import { NextStep } from "@/components/next-step";
import { NeedsYou } from "@/components/needs-you";
import { loadNeedsYou } from "@/lib/needs-you-data";
import { Kpi } from "@/components/charts";
import { PageHeader, PageGroup, Section, Empty } from "@/components/page";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { readStrategyState } from "@/lib/strategy-state";
import { readSetupState } from "@/lib/setup-state";
import { readFunnelData } from "@/lib/funnel-data";
import { StrategyStatus } from "@/components/strategy-status";

import { DailyReportSection } from "./report-section";
import { LimitsSection } from "./limits-section";
import { ResultsSection } from "./analytics-section";
import { SpendSection } from "./usage-section";
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

  const [{ state: setup, next }, funnel, { data: profiles }] = await Promise.all([
    readSetupState(supabase, session.workspaceId),
    readFunnelData(supabase, session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority, approved_at, do_not_pursue")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
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

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <PageHeader
        title={session.fullName ? `Morning, ${session.fullName.split(" ")[0]}.` : "Overview"}
        lede="What needs you, and whether yesterday's sending worked."
        actions={
          <Link className="btn ghost small" href="/app/analytics">
            All results
          </Link>
        }
      />

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

      <Section
        id="results"
        title="How it is going"
        description="The whole picture, including what each strategy produced and what it cost, is on Results."
        action={
          <Link className="btn ghost small" href="/app/analytics">
            Open Results
          </Link>
        }
      >
        <div className="kpi-row">
          <Kpi
            label="Invited (7 days)"
            value={report.momentum.current.toLocaleString()}
            note={
              report.momentum.change === null
                ? "No week before this one to compare."
                : `${report.momentum.change >= 0 ? "+" : ""}${Math.round(report.momentum.change * 100)}% on the week before`
            }
          />
          <Kpi label="Accepted" value={report.counts.accepted.toLocaleString()} />
          <Kpi label="Replied" value={report.counts.replied.toLocaleString()} />
          {/*
            "Waiting on you" is not a result, and it was the second reading of a
            question the list at the top of this page already answers — a
            counter that disagrees with the list above it is worse than none.

            Meetings takes the slot only when a campaign here can actually reach
            that stage. `report.stages` already knows (rule 29): a workspace
            whose campaigns all ask for a sign-up would otherwise get a
            permanent zero, which reports a working campaign as a failed one
            every day for ever.
          */}
          {report.stages.some((stage) => stage.key === "meetings") ? (
            <Kpi label="Meetings" value={report.counts.meetings.toLocaleString()} />
          ) : null}
        </div>
      </Section>

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
                    <td className="num mono">{profile.priority}</td>
                    <td className="num mono">
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
          <Empty title="No strategies yet." action="Start the Strategy Agent" href="/app/strategy">
            The Strategy Agent reads your site and writes who to go after. Your business profile and
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
      <PageGroup id="spend">
        <SpendSection />
      </PageGroup>
    </>
  );
}
