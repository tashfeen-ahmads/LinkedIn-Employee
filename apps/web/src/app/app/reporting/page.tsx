import Link from "next/link";
import {
  CTA_DEFINITIONS,
  MIN_FOR_RATE,
  RATE_TARGETS,
  countFunnel,
  funnelReport,
  rate,
  stagesForGoals,
  type CtaKind,
  type DatedFunnelRow,
  type FunnelStage,
  type Rate,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readFunnelData } from "@/lib/funnel-data";
import { FunnelPanel } from "@/components/funnel-panel";

/**
 * Where outreach is working and where it stops.
 *
 * A table rather than a chart: for three to twenty reps the numbers are the
 * point, and a grouped bar chart across reps and five stages is unreadable at
 * exactly the size this page is used at. The inline bars are a scanning aid
 * that encodes the same numbers beside them — never a trapezoid funnel, whose
 * area misrepresents the drop-off it claims to show.
 *
 * Every stage column here is one the campaigns in question could actually
 * reach. A link campaign has no meetings and never will (rule 29), so a
 * "Meetings" column of permanent zeros reports work that did exactly what was
 * asked of it as a failure — every day, for ever.
 */
export default async function ReportingPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [funnel, { data: memberships }, { data: profiles }] = await Promise.all([
    readFunnelData(supabase, session.workspaceId),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("workspace_id", session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
  ]);

  // Selected as a foreign key and fetched separately rather than as an embedded
  // join: PostgREST would return the related row, the worker's fake database
  // cannot, and the shape that silently differs between the two is the one that
  // produced green, wrong tests here before.
  const userIds = (memberships ?? []).map((m) => m.user_id);
  const { data: people } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  const byRep = new Map<string, DatedFunnelRow[]>();
  const goalsByRep = new Map<string, Set<CtaKind>>();
  const byStrategy = new Map<string, DatedFunnelRow[]>();
  const goalsByStrategy = new Map<string, Set<CtaKind>>();

  const add = <K,>(map: Map<K, DatedFunnelRow[]>, key: K, rows: DatedFunnelRow[]) => {
    const list = map.get(key);
    if (list) list.push(...rows);
    else map.set(key, [...rows]);
  };
  const note = <K,>(map: Map<K, Set<CtaKind>>, key: K, goal: CtaKind) => {
    const set = map.get(key);
    if (set) set.add(goal);
    else map.set(key, new Set([goal]));
  };

  for (const campaign of funnel.campaigns) {
    const rows = funnel.rowsByCampaign.get(campaign.id) ?? [];
    add(byRep, campaign.owner_user_id, rows);
    note(goalsByRep, campaign.owner_user_id, campaign.cta_kind);
    // A campaign with no strategy is grouped under "none" rather than dropped:
    // a name that quietly goes missing from a report is its own bug report.
    const strategy = campaign.customer_profile_id ?? "none";
    add(byStrategy, strategy, rows);
    note(goalsByStrategy, strategy, campaign.cta_kind);
  }

  // A rep sees their own row; anyone who can manage the team sees everyone.
  const canSeeTeam = ["owner", "admin", "manager"].includes(session.role);
  const visible = (memberships ?? []).filter((m) => canSeeTeam || m.user_id === session.userId);

  const reps = visible
    .map((membership) => {
      const rows = byRep.get(membership.user_id) ?? [];
      const counts = countFunnel(rows);
      return {
        userId: membership.user_id,
        name: nameById.get(membership.user_id) ?? "Unknown",
        role: membership.role,
        counts,
        stages: stagesForGoals([...(goalsByRep.get(membership.user_id) ?? [])]),
        acceptance: rate(counts.accepted, counts.invited, RATE_TARGETS.acceptance),
        reply: rate(counts.replied, counts.accepted, RATE_TARGETS.reply),
      };
    })
    .sort((a, b) => b.counts.meetings - a.counts.meetings || b.counts.invited - a.counts.invited);

  const report = funnelReport(funnel.rows, funnel.goals);
  // One shared scale across rows, so reps are comparable rather than each bar
  // being drawn against itself.
  const peak = Math.max(1, ...reps.map((r) => r.counts.invited));
  const workspaceStages = report.stages;

  return (
    <>
      <div className="page-head">
        <h1>Reporting</h1>
        <p className="muted">
          {canSeeTeam
            ? "Where outreach is working and where it stops — per strategy, per rep, per campaign."
            : "Your own outreach. Team-wide figures are visible to managers."}
        </p>
      </div>

      <FunnelPanel report={report} goals={funnel.goals} truncated={funnel.truncated} />

      <section className="stack-3">
        <div className="section-head">
          <h2>By strategy</h2>
          <p className="small subtle">
            A fit score means nothing without the strategy it was scored against, and neither does a
            funnel. This is what each one has actually produced.
          </p>
        </div>
        {byStrategy.size === 0 ? (
          <p className="small muted">
            No campaign has been built yet. <Link href="/app/strategy">Approve a strategy</Link> and
            this fills in.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Asking for</th>
                  {workspaceStages.map((stage) => (
                    <th key={stage.key} className="num">
                      {stage.label}
                    </th>
                  ))}
                  <th className="num">Acceptance</th>
                </tr>
              </thead>
              <tbody>
                {[...byStrategy.entries()].map(([id, rows]) => {
                  const counts = countFunnel(rows);
                  const goals = [...(goalsByStrategy.get(id) ?? [])];
                  const stages = stagesForGoals(goals);
                  return (
                    <tr key={id}>
                      <td>{id === "none" ? <span className="subtle">No strategy</span> : profileNameById.get(id) ?? "—"}</td>
                      <td className="small muted">
                        {goals.map((g) => CTA_DEFINITIONS[g].label).join(", ")}
                      </td>
                      <StageCells stages={stages} shown={workspaceStages} counts={counts} />
                      <td className="num">
                        <RateCell rate={rate(counts.accepted, counts.invited, RATE_TARGETS.acceptance)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack-3">
        <div className="section-head">
          <h2>{canSeeTeam ? "By rep" : "You"}</h2>
        </div>
        {reps.every((rep) => rep.counts.invited === 0) ? (
          <p className="small muted">No outreach has gone out yet. Launch a campaign and this fills in.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="col-wide">Funnel</th>
                  {workspaceStages.map((stage) => (
                    <th key={stage.key} className="num">
                      {stage.label}
                    </th>
                  ))}
                  <th className="num">Acceptance</th>
                  <th className="num">Reply</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((rep) => (
                  <tr key={rep.userId}>
                    <td>
                      {rep.name}
                      <p className="small muted">{rep.role}</p>
                    </td>
                    <td>
                      <FunnelBar stages={rep.stages} counts={rep.counts} peak={peak} name={rep.name} />
                    </td>
                    <StageCells stages={rep.stages} shown={workspaceStages} counts={rep.counts} />
                    <td className="num">
                      <RateCell rate={rep.acceptance} />
                    </td>
                    <td className="num">
                      <RateCell rate={rep.reply} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">
          A rate appears once there are {MIN_FOR_RATE} in its denominator. Below that a percentage
          says more about the sample than the rep.
        </p>
      </section>

      {funnel.campaigns.length ? (
        <section className="stack-3">
          <div className="section-head">
            <h2>By campaign</h2>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Asking for</th>
                  <th>Status</th>
                  {workspaceStages.map((stage) => (
                    <th key={stage.key} className="num">
                      {stage.label}
                    </th>
                  ))}
                  <th className="num">Acceptance</th>
                </tr>
              </thead>
              <tbody>
                {funnel.campaigns
                  .filter((campaign) => canSeeTeam || campaign.owner_user_id === session.userId)
                  .map((campaign) => {
                    const counts = countFunnel(funnel.rowsByCampaign.get(campaign.id) ?? []);
                    return (
                      <tr key={campaign.id}>
                        <td>
                          <Link href={`/app/campaigns/${campaign.id}`}>{campaign.name}</Link>
                        </td>
                        <td className="small muted">{CTA_DEFINITIONS[campaign.cta_kind].label}</td>
                        <td>
                          <span className={`pill ${campaign.status === "running" ? "positive" : ""}`}>
                            {campaign.status}
                          </span>
                        </td>
                        <StageCells
                          stages={stagesForGoals([campaign.cta_kind])}
                          shown={workspaceStages}
                          counts={counts}
                        />
                        <td className="num">
                          <RateCell rate={rate(counts.accepted, counts.invited, RATE_TARGETS.acceptance)} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

/**
 * One row's stage counts, under the table's own columns.
 *
 * A row whose campaigns cannot reach a column gets an explicit "not this
 * campaign's goal" rather than a zero. The table needs one set of columns to be
 * a table at all, and a zero in a column this row could never score in is the
 * exact misreading rule 29 exists to stop — it just moves it from the page to
 * the cell.
 */
function StageCells({
  stages,
  shown,
  counts,
}: {
  stages: readonly FunnelStage[];
  shown: readonly FunnelStage[];
  counts: ReturnType<typeof countFunnel>;
}) {
  const reachable = new Set(stages.map((s) => s.key));
  return (
    <>
      {shown.map((stage) =>
        reachable.has(stage.key) ? (
          <td key={stage.key} className="mono num">
            {counts[stage.key].toLocaleString()}
          </td>
        ) : (
          <td key={stage.key} className="num subtle" title="Not what this campaign is asking for">
            n/a
          </td>
        ),
      )}
    </>
  );
}

/**
 * Magnitude bars, widths on one shared scale so reps are comparable across
 * rows. One hue darkening down the funnel: the stages are ordered, so the ramp
 * is sequential rather than several arbitrary colours. Numbers sit in their own
 * columns, so nothing depends on reading the bar.
 */
function FunnelBar({
  stages,
  counts,
  peak,
  name,
}: {
  stages: readonly FunnelStage[];
  counts: ReturnType<typeof countFunnel>;
  peak: number;
  name: string;
}) {
  return (
    <div
      className="funnel"
      role="img"
      aria-label={stages.map((s) => `${s.label} ${counts[s.key]}`).join(", ") + ` for ${name}`}
    >
      {stages.map((stage, index) => (
        <div key={stage.key}>
          <span
            style={{
              width: `${Math.min(100, (counts[stage.key] / peak) * 100)}%`,
              opacity: 1 - index * 0.16,
              // A stage with anyone in it stays visible at any scale; a stage
              // with nobody draws nothing at all.
              minWidth: counts[stage.key] > 0 ? 3 : 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Status colour plus the word, so the state never rests on colour alone. */
function RateCell({ rate }: { rate: Rate }) {
  if (rate.verdict === "too-early") {
    return (
      <span className="small subtle" title={`${rate.denominator} so far; a rate appears at ${MIN_FOR_RATE}`}>
        —
      </span>
    );
  }
  return (
    <span className={`pill ${rate.verdict === "on-target" ? "positive" : "warning"}`}>
      {((rate.value ?? 0) * 100).toFixed(0)}%
    </span>
  );
}
