import Link from "next/link";
import { FUNNEL_STAGES, countFunnel } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { SetupChecklist } from "@/components/setup-checklist";
import { createClient } from "@/lib/supabase-server";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { hasToldUsWhatTheySell, readStrategyState } from "@/lib/strategy-state";
import { StrategyStatus } from "@/components/strategy-status";

export default async function OverviewPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const head = { count: "exact" as const, head: true };
  const [
    { data: rows },
    { data: profiles },
    business,
    approved,
    account,
    campaign,
    launched,
    calendar,
    knowledge,
  ] = await Promise.all([
    supabase.from("campaign_prospects").select("status, invited_at, accepted_at, replied_at").eq("workspace_id", session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority, approved_at, do_not_pursue")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    supabase.from("business_profiles").select("id", head).eq("workspace_id", session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, approved_at", head)
      .eq("workspace_id", session.workspaceId)
      .not("approved_at", "is", null),
    supabase
      .from("linkedin_accounts")
      .select("id, status", head)
      .eq("workspace_id", session.workspaceId)
      .eq("status", "active"),
    supabase.from("campaigns").select("id", head).eq("workspace_id", session.workspaceId),
    supabase
      .from("campaigns")
      .select("id, launched_at", head)
      .eq("workspace_id", session.workspaceId)
      .not("launched_at", "is", null),
    supabase
      .from("integrations")
      .select("id, kind", head)
      .eq("workspace_id", session.workspaceId)
      .in("kind", ["google_calendar", "microsoft_calendar"]),
    supabase.from("knowledge_documents").select("id", head).eq("workspace_id", session.workspaceId),
  ]);

  const any = (result: { count: number | null }) => (result.count ?? 0) > 0;
  const strategy = await readStrategyState(supabase, session.workspaceId, any(business));
  // The same seven facts the nudge emails read, from the same shared list of
  // steps — so the inbox and the dashboard can never disagree.
  const setup = {
    // Ticked when the person has done their part, not when the agent has done
    // its own. This step's only output is written by the Strategy Agent, and
    // reading its absence as "they have not filled in the form" told a real
    // tester for twenty-one minutes that they had not, with a Start button
    // that would have queued the whole thing a second time.
    hasBusinessProfile: hasToldUsWhatTheySell(strategy),
    hasApprovedProfile: any(approved),
    hasLinkedInAccount: any(account),
    hasCampaign: any(campaign),
    hasLaunchedCampaign: any(launched),
    hasCalendar: any(calendar),
    hasKnowledge: any(knowledge),
  };

  // One definition of the funnel, shared with the reporting page: two copies
  // would drift and quietly disagree about the same numbers.
  const tally = countFunnel(rows ?? []);
  const counts = FUNNEL_STAGES.map((stage) => ({ label: stage.label, value: tally[stage.key] }));

  const invited = tally.invited;
  const accepted = tally.accepted;
  const replied = tally.replied;

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <header className="page-head">
        <p className="eyebrow">Overview</p>
        <h1>{session.fullName ? `Morning, ${session.fullName.split(" ")[0]}.` : "Overview"}</h1>
      </header>

      <StrategyStatus state={strategy} />

      <SetupChecklist state={setup} />

      <section className="stack-3">
        <div className="grid grid-4">
          {counts.map((stage) => (
            <div key={stage.label} className="card tight stat">
              <span className="stat-label">{stage.label}</span>
              <span className="stat-value">{stage.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stack-3">
        <div className="section-head">
          <h2>Rates</h2>
          <p className="small subtle">Against the targets a healthy account holds.</p>
        </div>
        <div className="grid grid-2">
          <Rate label="Acceptance" numerator={accepted} denominator={invited} target={0.3} />
          <Rate label="Reply" numerator={replied} denominator={accepted} target={0.15} />
        </div>
      </section>

      <section className="stack-3">
        <div className="between">
          <div className="section-head">
            <h2>Customer profiles</h2>
            <p className="small subtle">Nothing is searched for until one is approved.</p>
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
                  <th>Profile</th>
                  <th className="num">Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.name}</td>
                    <td className="num mono">{profile.priority}</td>
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

/**
 * A rate against its target. The target is drawn as a mark on the bar rather
 * than written beside the number: "12.4% (target 15%)" makes a reader do the
 * comparison, a bar does it for them.
 */
function Rate({
  label,
  numerator,
  denominator,
  target,
}: {
  label: string;
  numerator: number;
  denominator: number;
  target: number;
}) {
  if (denominator === 0) {
    return (
      <div className="card tight stat">
        <span className="stat-label">{label}</span>
        <span className="stat-value subtle">—</span>
        <span className="stat-note">Not enough data yet</span>
      </div>
    );
  }

  const rate = numerator / denominator;
  const met = rate >= target;
  // Both bars share a scale that runs to twice the target, so acceptance and
  // reply can be read against each other rather than each against itself.
  const scale = target * 2;
  const width = Math.min(100, (rate / scale) * 100);

  return (
    <div className="card tight stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{(rate * 100).toFixed(1)}%</span>
      <div aria-hidden="true" className={`meter vs-target ${met ? "is-met" : "is-short"}`}>
        <span style={{ width: `${width}%` }} />
        <div className="meter-tick" />
      </div>
      <span className="stat-note">
        {numerator.toLocaleString()} of {denominator.toLocaleString()} · target{" "}
        {(target * 100).toFixed(0)}%
      </span>
    </div>
  );
}
