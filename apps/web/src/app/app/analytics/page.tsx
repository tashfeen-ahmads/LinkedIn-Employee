import Link from "next/link";
import {
  CLICKS_ARE_INVISIBLE,
  CTA_DEFINITIONS,
  MIN_FOR_RATE,
  RATE_TARGETS,
  countFunnel,
  dailySends,
  funnelReport,
  rate,
  stagesForGoals,
  type CtaKind,
  type DatedFunnelRow,
  type Rate,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readFunnelData } from "@/lib/funnel-data";
import { fetchAllRows } from "@/lib/rows";
import { PageHeader, Section, Empty } from "@/components/page";
import { FunnelChart, Kpi, RankedBars, TrendChart } from "@/components/charts";
import { formatUsd } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Results. One page, and the only one.
 *
 * There were two: a KPI block on the dashboard and a Reporting screen, each
 * computing the same five numbers from its own query. Two readings of one set
 * of facts always end up disagreeing, and the one somebody believes is
 * whichever they happened to open — so the dashboard now leads with the next
 * action and links here, and every number lives on this page.
 *
 * It answers four questions, in the order they get asked: is it running, what
 * is it producing, which strategy is producing it, and what is it costing.
 */
export default async function AnalyticsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const now = Date.now();

  const [funnel, { data: profiles }, { data: memberships }, spend] = await Promise.all([
    readFunnelData(supabase, session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    supabase.from("memberships").select("user_id, role").eq("workspace_id", session.workspaceId),
    // Paged: llm_calls gains a row per agent call, so it is the first table
    // here to pass PostgREST's silent thousand-row cap.
    fetchAllRows<{ cost_usd: number | null; agent: string; created_at: string }>((from, to) =>
      supabase
        .from("llm_calls")
        .select("cost_usd, agent, created_at")
        .eq("workspace_id", session.workspaceId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const report = funnelReport(funnel.rows, funnel.goals, now);
  const trend = dailySends(funnel.rows, now, 30);

  const canSeeTeam = ["owner", "admin", "manager"].includes(session.role);
  const mine = new Set(
    funnel.campaigns.filter((c) => c.owner_user_id === session.userId).map((c) => c.id),
  );
  const visibleRows = canSeeTeam
    ? funnel.rows
    : funnel.rows.filter((r) => mine.has((r as DatedFunnelRow & { campaign_id: string }).campaign_id));

  // Grouped by the strategy each campaign was built from. A fit score means
  // nothing without the strategy it was scored against, and neither does a
  // funnel.
  const byStrategy = new Map<string, { rows: DatedFunnelRow[]; goals: Set<CtaKind>; name: string }>();
  const profileName = new Map((profiles ?? []).map((p) => [p.id, p.name]));
  for (const campaign of funnel.campaigns) {
    const key = campaign.customer_profile_id ?? "none";
    const entry = byStrategy.get(key) ?? {
      rows: [],
      goals: new Set<CtaKind>(),
      name: key === "none" ? "No strategy" : profileName.get(key) ?? "—",
    };
    entry.rows.push(...(funnel.rowsByCampaign.get(campaign.id) ?? []));
    entry.goals.add(campaign.cta_kind);
    byStrategy.set(key, entry);
  }

  const strategyBars = [...byStrategy.entries()]
    .map(([id, entry]) => {
      const counts = countFunnel(entry.rows);
      const acceptance = rate(counts.accepted, counts.invited, RATE_TARGETS.acceptance);
      return {
        label: entry.name,
        value: counts.invited,
        note:
          counts.invited === 0
            ? "nothing sent yet"
            : `${counts.accepted} accepted · ${describeRate(acceptance)}`,
        href: id === "none" ? undefined : `/app/prospects?strategy=${id}`,
      };
    })
    .sort((a, b) => b.value - a.value);

  const campaignBars = funnel.campaigns
    .filter((c) => canSeeTeam || c.owner_user_id === session.userId)
    .map((c) => {
      const counts = countFunnel(funnel.rowsByCampaign.get(c.id) ?? []);
      return {
        label: c.name,
        value: counts.invited,
        note: `${CTA_DEFINITIONS[c.cta_kind].label} · ${c.status}${
          counts.accepted ? ` · ${counts.accepted} accepted` : ""
        }`,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // What it cost. A model missing from the price table stores null rather than
  // zero, so an unpriced call stays out of the total instead of being counted
  // as free — and the count of priced calls is what says how much of the total
  // is real.
  const priced = spend.rows.filter((r) => r.cost_usd !== null);
  const totalSpend = priced.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  const perOutcome = report.counts.invited > 0 ? totalSpend / report.counts.invited : null;

  const funnelSteps = report.stages.map((stage) => ({
    label: stage.label,
    value: report.counts[stage.key],
    hint: stage.label,
  }));

  const nothingYet = report.counts.invited === 0;

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Results"
        lede="Every conversion, every strategy and what it cost — the whole picture on one page."
        actions={
          <Link className="btn ghost small" href="/app/campaigns">
            Campaigns
          </Link>
        }
      />

      {funnel.truncated ? (
        <div className="notice warning">
          <p className="small">
            There are more prospects here than this page reads in one go, so these totals are a
            floor rather than the whole picture.
          </p>
        </div>
      ) : null}

      <Section id="headline" title="This week">
        <div className="kpi-row">
          <Kpi
            label="Invited (7 days)"
            value={report.momentum.current.toLocaleString()}
            trend={trend.slice(-14)}
            note={
              report.momentum.change === null
                ? "First week of sending — no week before it to compare."
                : `${report.momentum.change >= 0 ? "+" : ""}${Math.round(
                    report.momentum.change * 100,
                  )}% on the week before`
            }
          />
          <Kpi
            label="Acceptance"
            value={rateValue(report.acceptance)}
            tone={toneFor(report.acceptance)}
            note={describeRate(report.acceptance)}
          />
          <Kpi
            label="Reply"
            value={rateValue(report.reply)}
            tone={toneFor(report.reply)}
            note={describeRate(report.reply)}
          />
          <Kpi
            label="Agent spend"
            value={formatUsd(totalSpend)}
            note={
              perOutcome === null
                ? `${priced.length.toLocaleString()} priced calls`
                : `${formatUsd(perOutcome)} per person invited`
            }
          />
        </div>
      </Section>

      <Section
        id="sending"
        title="Invitations per day"
        description="The one figure here that can fall. Totals only ever go up, so a campaign that stopped a fortnight ago and one sending today look identical without this."
      >
        <div className="card">
          <TrendChart points={trend} label="Invitations per day" />
        </div>
      </Section>

      <Section
        id="funnel"
        title="Where people get to"
        description={
          funnel.goals.includes("link")
            ? CLICKS_ARE_INVISIBLE
            : "Each stage as a share of everyone invited, and the conversion from the stage above it."
        }
      >
        {nothingYet ? (
          <Empty title="Nobody has been invited yet." action="Open campaigns" href="/app/campaigns">
            Every stage below fills in once a campaign starts sending. Stages a campaign cannot
            reach are never shown, so a link campaign is not reported as failing to book meetings.
          </Empty>
        ) : (
          <div className="card">
            <FunnelChart steps={funnelSteps} />
          </div>
        )}
      </Section>

      <Section
        id="strategies"
        title="By strategy"
        description="A fit score means nothing without the strategy it was scored against, and neither does a funnel. This is what each one actually produced."
        action={
          <Link className="btn ghost small" href="/app/strategy">
            Manage strategies
          </Link>
        }
      >
        {strategyBars.length ? (
          <div className="card">
            <RankedBars data={strategyBars} />
          </div>
        ) : (
          <Empty title="No campaign has been built yet." action="Approve a strategy" href="/app/strategy">
            A strategy produces a campaign, and a campaign produces the numbers above.
          </Empty>
        )}
      </Section>

      {campaignBars.length ? (
        <Section id="campaigns" title="By campaign" description="The eight that have sent the most.">
          <div className="card">
            <RankedBars data={campaignBars} />
          </div>
        </Section>
      ) : null}

      <Section
        id="table"
        title="Every number"
        description={`A rate appears once there are ${MIN_FOR_RATE} in its denominator. Below that a percentage says more about the sample than the work.`}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Asking for</th>
                {report.stages.map((stage) => (
                  <th key={stage.key} className="num">
                    {stage.label}
                  </th>
                ))}
                <th className="num">Acceptance</th>
                <th className="num">Reply</th>
              </tr>
            </thead>
            <tbody>
              {[...byStrategy.entries()].map(([id, entry]) => {
                const counts = countFunnel(entry.rows);
                const reachable = new Set(stagesForGoals([...entry.goals]).map((s) => s.key));
                return (
                  <tr key={id}>
                    <td>{entry.name}</td>
                    <td className="small muted">
                      {[...entry.goals].map((g) => CTA_DEFINITIONS[g].label).join(", ")}
                    </td>
                    {report.stages.map((stage) =>
                      reachable.has(stage.key) ? (
                        <td key={stage.key} className="num mono">
                          {counts[stage.key].toLocaleString()}
                        </td>
                      ) : (
                        <td
                          key={stage.key}
                          className="num subtle"
                          title="Not what these campaigns are asking for"
                        >
                          n/a
                        </td>
                      ),
                    )}
                    <td className="num">
                      <RatePill rate={rate(counts.accepted, counts.invited, RATE_TARGETS.acceptance)} />
                    </td>
                    <td className="num">
                      <RatePill rate={rate(counts.replied, counts.accepted, RATE_TARGETS.reply)} />
                    </td>
                  </tr>
                );
              })}
              <tr className="row-total">
                <td>
                  <strong>All</strong>
                </td>
                <td />
                {report.stages.map((stage) => (
                  <td key={stage.key} className="num mono">
                    <strong>{countFunnel(visibleRows)[stage.key].toLocaleString()}</strong>
                  </td>
                ))}
                <td className="num">
                  <RatePill rate={report.acceptance} />
                </td>
                <td className="num">
                  <RatePill rate={report.reply} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {!canSeeTeam ? (
          <p className="tiny subtle">
            Showing your own campaigns. Team-wide figures are visible to managers.
          </p>
        ) : null}
        <p className="tiny subtle">
          {(memberships ?? []).length} member{(memberships ?? []).length === 1 ? "" : "s"} ·{" "}
          {funnel.campaigns.length} campaign{funnel.campaigns.length === 1 ? "" : "s"} ·{" "}
          {priced.length.toLocaleString()} priced agent call
          {priced.length === 1 ? "" : "s"}
          {priced.length < spend.rows.length
            ? ` (${(spend.rows.length - priced.length).toLocaleString()} unpriced, left out of the total rather than counted as free)`
            : ""}
        </p>
      </Section>
    </>
  );
}

function rateValue(r: Rate): string {
  return r.value === null ? "—" : `${(r.value * 100).toFixed(1)}%`;
}

function toneFor(r: Rate): "positive" | "warning" | "neutral" {
  if (r.verdict === "too-early") return "neutral";
  return r.verdict === "on-target" ? "positive" : "warning";
}

/** Why there is no rate, or how this one sits against its target. */
function describeRate(r: Rate): string {
  if (r.verdict === "too-early") {
    return `${r.denominator.toLocaleString()} so far — a rate appears at ${MIN_FOR_RATE}.`;
  }
  return `${r.numerator.toLocaleString()} of ${r.denominator.toLocaleString()} · ${
    r.verdict === "on-target" ? "on target" : "below"
  } ${(r.target * 100).toFixed(0)}%`;
}

/** Status colour plus the word, so the state never rests on colour alone. */
function RatePill({ rate }: { rate: Rate }) {
  if (rate.verdict === "too-early") {
    return (
      <span className="small subtle" title={`${rate.denominator} so far; a rate appears at ${MIN_FOR_RATE}`}>
        —
      </span>
    );
  }
  return (
    <span className={`pill tiny ${rate.verdict === "on-target" ? "positive" : "warning"}`}>
      {((rate.value ?? 0) * 100).toFixed(0)}%
    </span>
  );
}
