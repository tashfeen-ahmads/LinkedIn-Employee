import Link from "next/link";
import {
  CLICKS_ARE_INVISIBLE,
  CTA_DEFINITIONS,
  EXTERNAL_BOOKINGS_UNCOUNTED,
  MIN_FOR_RATE,
  RATE_TARGETS,
  countFunnel,
  dailySends,
  funnelReport,
  rate,
  stagesForGoals,
  type CtaKind,
  type DatedFunnelRow,
  type FunnelReport,
  type Rate,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readFunnelData } from "@/lib/funnel-data";
import { workspaceUsesOwnBookingLink } from "@/lib/booking-link";
import { canSeeTeamFunnel, scopeFunnel } from "@/lib/funnel-scope";
import { Section, Empty } from "@/components/page";
import { FunnelChart, RankedBars, TrendChart } from "@/components/charts";
import { label } from "@/lib/labels";

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
 * It answers three questions, in the order they get asked: is it running, what
 * is it producing, and which strategy is producing it.
 *
 * Not what it costs. What the agents cost is our margin, not the customer's
 * bill: a rep pays a seat price that does not move with it, so a token total on
 * their dashboard is a number they cannot act on, cannot change, and will
 * reasonably read as something they are being charged for. `/app/usage` was
 * redirected away for exactly that reason and the tile stayed behind, which is
 * the worse half of the two — a removed screen is obvious, a surviving number
 * on the screen everybody opens is not. It lives in the operator console, on
 * `platform_workspace_spend()`, where somebody can do something about it.
 */
export async function ResultsSection() {
  const session = await requireSession();
  const supabase = await createClient();
  const now = Date.now();

  const [everything, { data: profiles }, { data: memberships }, ownBookingLink] = await Promise.all([
    readFunnelData(supabase, session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    supabase.from("memberships").select("user_id, role").eq("workspace_id", session.workspaceId),
    workspaceUsesOwnBookingLink(supabase, session.workspaceId),
  ]);

  // Scoped once, before anything is counted: a rep reads their own campaigns
  // in every figure on this page, not only in the total row.
  const canSeeTeam = canSeeTeamFunnel(session.role);
  const funnel = scopeFunnel(everything, { userId: session.userId, canSeeTeam });
  const report = funnelReport(funnel.rows, funnel.goals, now);
  const trend = dailySends(funnel.rows, now, 30);
  const visibleRows = funnel.rows;

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
      name: key === "none" ? "No strategy" : profileName.get(key) ?? "Unnamed strategy",
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
    .map((c) => {
      const counts = countFunnel(funnel.rowsByCampaign.get(c.id) ?? []);
      return {
        label: c.name,
        value: counts.invited,
        href: `/app/campaigns/${c.id}`,
        note: `${CTA_DEFINITIONS[c.cta_kind].label} · ${label(c.status)}${
          counts.accepted ? ` · ${counts.accepted} accepted` : ""
        }`,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const funnelSteps = report.stages.map((stage) => ({
    label: stage.label,
    value: report.counts[stage.key],
    hint: stage.label,
  }));

  const nothingYet = report.counts.invited === 0;

  return (
    <>

      {funnel.truncated ? (
        <div className="notice warning">
          <p className="small">
            There are more prospects here than this page reads in one go, so these totals are a
            floor rather than the whole picture.
          </p>
        </div>
      ) : null}

      {/*
        "This week" moved to the top of the overview as its stat row
        (`HeadlineStats` below), so the four figures are read once, in the
        place somebody looks first, rather than twice on one screen.
      */}

      <Section
        id="sending"
        title="Invitations per day"
        description="How many invitations went out each day for the last 30 days. A line at zero means nothing was sent that day."
      >
        <div className="card">
          <TrendChart points={trend} label="Invitations per day" />
        </div>
      </Section>

      <Section
        id="funnel"
        title="Where people get to"
        description={[
          funnel.goals.includes("link")
            ? CLICKS_ARE_INVISIBLE
            : "Out of everyone invited, how many said yes, replied and booked.",
          // Rule 31: a meetings stage beside a rep's own scheduling link
          // undercounts, and says so rather than reading as a campaign that
          // booked nobody.
          ownBookingLink && funnel.goals.includes("meeting") ? EXTERNAL_BOOKINGS_UNCOUNTED : null,
        ]
          .filter(Boolean)
          .join(" ")}
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
        id="by-strategy"
        title="By strategy"
        description="How many people each strategy has reached, and how many said yes."
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
        <Section id="campaigns" title="By campaign" description="Your eight busiest campaigns.">
          <div className="card">
            <RankedBars data={campaignBars} />
          </div>
        </Section>
      ) : null}

      <Section
        id="table"
        title="All the numbers"
        description={`Everything in one table. A percentage shows once there are ${MIN_FOR_RATE} people to count from.`}
      >
        <div className="table-scroll card-rows">
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
                    <td data-label="Strategy">{entry.name}</td>
                    <td data-label="Asking for" className="small muted">
                      {[...entry.goals].map((g) => CTA_DEFINITIONS[g].label).join(", ")}
                    </td>
                    {report.stages.map((stage) =>
                      reachable.has(stage.key) ? (
                        <td key={stage.key} data-label={stage.label} className="num">
                          {counts[stage.key].toLocaleString()}
                        </td>
                      ) : (
                        <td
                          data-label={stage.label}
                          key={stage.key}
                          className="num subtle"
                          title="Not what these campaigns are asking for"
                        >
                          n/a
                        </td>
                      ),
                    )}
                    <td data-label="Acceptance" className="num">
                      <RatePill rate={rate(counts.accepted, counts.invited, RATE_TARGETS.acceptance)} />
                    </td>
                    <td data-label="Reply" className="num">
                      <RatePill rate={rate(counts.replied, counts.accepted, RATE_TARGETS.reply)} />
                    </td>
                  </tr>
                );
              })}
              <tr className="row-total">
                <td data-label="Strategy">
                  <strong>All</strong>
                </td>
                <td data-label="Asking for" />
                {report.stages.map((stage) => (
                  <td key={stage.key} data-label={stage.label} className="num">
                    <strong>{countFunnel(visibleRows)[stage.key].toLocaleString()}</strong>
                  </td>
                ))}
                <td data-label="Acceptance" className="num">
                  <RatePill rate={report.acceptance} />
                </td>
                <td data-label="Reply" className="num">
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
          {funnel.campaigns.length} campaign{funnel.campaigns.length === 1 ? "" : "s"}
        </p>
      </Section>
    </>
  );
}

/**
 * The overview's four figures, in the words a business owner uses.
 *
 * Counts first and percentages second: "22 said yes" means something to
 * anybody, "Acceptance 62.9%" only to somebody who already runs outreach. All
 * four are totals from the same `funnelReport` the Results page reads, so a
 * figure here and the funnel there can never disagree, and Meetings only
 * appears where a campaign here can reach that stage (rule 29).
 */
export function HeadlineStats({
  report,
  ownBookingLink = false,
}: {
  report: FunnelReport;
  /** Somebody here sends their own scheduling link, whose bookings are not counted (rule 31). */
  ownBookingLink?: boolean;
}) {
  const week = report.momentum.current;
  return (
    <Section
      id="how-its-going"
      title="How it’s going"
      action={
        <Link className="btn ghost small" href="/app/analytics">
          See full results
        </Link>
      }
    >
      <div className="headline-stats" role="group" aria-label="Totals so far">
        <HeadlineStat
          label="People invited"
          value={report.counts.invited.toLocaleString()}
          note={week ? `${week.toLocaleString()} in the last 7 days.` : "None in the last 7 days."}
        />
        <HeadlineStat
          label="Said yes"
          value={report.counts.accepted.toLocaleString()}
          tone={toneFor(report.acceptance)}
          note={plainRate(report.acceptance, "of the people invited")}
        />
        <HeadlineStat
          label="Replied"
          value={report.counts.replied.toLocaleString()}
          tone={toneFor(report.reply)}
          note={plainRate(report.reply, "of the people who said yes")}
        />
        {report.stages.some((stage) => stage.key === "meetings") ? (
          <HeadlineStat
            label="Meetings booked"
            value={report.counts.meetings.toLocaleString()}
            note={
              ownBookingLink
                ? "Meetings booked through your own scheduling link are not counted."
                : "Across every campaign."
            }
          />
        ) : null}
      </div>
    </Section>
  );
}

/** A rate as a sentence: the share, and whether that is good, in words. */
function plainRate(r: Rate, ofWhom: string): string {
  if (r.verdict === "too-early") {
    return `A percentage shows once there are ${MIN_FOR_RATE} to count from.`;
  }
  const share = `${Math.round((r.value ?? 0) * 100)}% ${ofWhom}.`;
  return r.verdict === "on-target"
    ? `${share} Better than the usual ${Math.round(r.target * 100)}%.`
    : `${share} The usual is about ${Math.round(r.target * 100)}%.`;
}

/** One figure in the row. The tone is a state, and the note always says it in words. */
function HeadlineStat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "positive" | "warning" | "neutral";
}) {
  return (
    <div className="headline-stat">
      <span className="headline-label">{label}</span>
      <span className={`headline-value${tone === "neutral" ? "" : ` is-${tone}`}`}>{value}</span>
      <span className="headline-note">{note}</span>
    </div>
  );
}

function toneFor(r: Rate): "positive" | "warning" | "neutral" {
  if (r.verdict === "too-early") return "neutral";
  return r.verdict === "on-target" ? "positive" : "warning";
}

/** Why there is no rate, or how this one sits against its target. */
function describeRate(r: Rate): string {
  if (r.verdict === "too-early") {
    return `${r.denominator.toLocaleString()} so far. A rate appears at ${MIN_FOR_RATE}.`;
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
        Not yet
      </span>
    );
  }
  return (
    <span className={`pill tiny ${rate.verdict === "on-target" ? "positive" : "warning"}`}>
      {((rate.value ?? 0) * 100).toFixed(0)}%
    </span>
  );
}
