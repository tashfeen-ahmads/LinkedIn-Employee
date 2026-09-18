import Link from "next/link";
import { funnelReport, isReadyToSend } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { SetupChecklist } from "@/components/setup-checklist";
import { NextStep } from "@/components/next-step";
import { FunnelPanel } from "@/components/funnel-panel";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { readStrategyState } from "@/lib/strategy-state";
import { readSetupState } from "@/lib/setup-state";
import { readFunnelData } from "@/lib/funnel-data";
import { StrategyStatus } from "@/components/strategy-status";

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
      <header className="page-head">
        <p className="eyebrow">Overview</p>
        <h1>{session.fullName ? `Morning, ${session.fullName.split(" ")[0]}.` : "Overview"}</h1>
      </header>

      {/*
        One action first, and the whole width of the page. The checklist below
        is the second reading: a reference for somebody who already knows the
        product, where this is the instruction for somebody who does not.
      */}
      <NextStep step={next} ready={isReadyToSend(setup)} />

      <StrategyStatus state={strategy} />

      <SetupChecklist state={setup} />

      <FunnelPanel report={report} goals={funnel.goals} truncated={funnel.truncated} />

      <section className="stack-3">
        <div className="between">
          <div className="section-head">
            <h2>Strategies</h2>
            <p className="small subtle">
              Nothing is searched for until one is approved. A fit score only means something
              against the strategy that produced it.
            </p>
          </div>
          <Link href="/app/strategy" className="btn secondary small">
            Review and approve
          </Link>
        </div>

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
          <div className="empty">
            <p className="small">
              The Strategy Agent has not finished yet, or has not been run. Your business profile and
              three to five customer profiles appear here when it does.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
