import Link from "next/link";
import { funnelReport, isReadyToSend } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { SetupChecklist } from "@/components/setup-checklist";
import { NextStep } from "@/components/next-step";
import { Kpi } from "@/components/charts";
import { PageHeader, Section, Empty } from "@/components/page";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { readStrategyState } from "@/lib/strategy-state";
import { readSetupState } from "@/lib/setup-state";
import { readFunnelData } from "@/lib/funnel-data";
import { StrategyStatus } from "@/components/strategy-status";

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

  const { count: waitingCount } = await supabase
    .from("reply_drafts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", session.workspaceId)
    .eq("status", "pending");
  const waiting = waitingCount ?? 0;

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
        One action first, and the whole width of the page. The checklist below
        is the second reading: a reference for somebody who already knows the
        product, where this is the instruction for somebody who does not.
      */}
      <NextStep step={next} ready={isReadyToSend(setup)} />

      <StrategyStatus state={strategy} />

      <SetupChecklist state={setup} />

      {/*
        A summary, and a link — not a second analytics page.
        The dashboard and Reporting each used to compute the same five numbers
        from their own query, which is two readings of one set of facts, and
        two readings drift. Four figures here answer "is it working"; every
        other number lives on Results.
      */}
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
          <Kpi
            label="Waiting on you"
            value={waiting.toLocaleString()}
            tone={waiting > 0 ? "warning" : "neutral"}
            note={waiting > 0 ? "In the Inbox." : "Nothing held for a human."}
          />
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
      <div id="results">
        <ResultsSection />
      </div>
      <div id="spend">
        <SpendSection />
      </div>
    </>
  );
}
