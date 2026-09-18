import { CLICKS_ARE_INVISIBLE, type FunnelReport, type Rate } from "@le/shared";

/**
 * The five numbers, the two rates, and whether anything went out this week.
 *
 * Every stage shown is one a campaign here could actually reach (rule 29), so
 * a workspace that only ever sends links is not reporting a permanent
 * "Meetings 0" as its result.
 */
export function FunnelPanel({
  report,
  goals,
  truncated,
}: {
  report: FunnelReport;
  goals: readonly string[];
  truncated?: boolean;
}) {
  const nothingYet = report.counts.invited === 0;

  return (
    <section className="stack-4" aria-labelledby="results-heading">
      <div className="between">
        <div className="section-head">
          <h2 id="results-heading">Results</h2>
          <p className="small subtle">
            Everyone a campaign here has reached, and how far they got.
          </p>
        </div>
        <Momentum report={report} />
      </div>

      {truncated ? (
        // The cap that used to be silent. A number that stopped counting is
        // worse than a number that says it stopped.
        <div className="notice warning">
          <p className="small">
            There are more prospects here than this page reads in one go, so these totals are a
            floor rather than the whole picture. Reporting breaks them down per campaign.
          </p>
        </div>
      ) : null}

      {/* Four stages or five, never anything else — an interpolated class name
          that can miss is a layout that silently collapses. */}
      <div className={`grid ${report.stages.length >= 5 ? "grid-5" : "grid-4"}`}>
        {report.stages.map((stage) => (
          <div key={stage.key} className="card tight stat">
            <span className="stat-label">{stage.label}</span>
            <span className={`stat-value ${nothingYet ? "subtle" : ""}`}>
              {report.counts[stage.key].toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-2">
        <RateTile label="Acceptance" rate={report.acceptance} />
        <RateTile label="Reply" rate={report.reply} />
      </div>

      {goals.includes("link") ? (
        <p className="tiny subtle">{CLICKS_ARE_INVISIBLE}</p>
      ) : null}
    </section>
  );
}

/**
 * Whether anything went out this week, and how that compares with last.
 *
 * Lifetime totals only go up, so a campaign that stopped a fortnight ago and
 * one sending today are the same five numbers. This is the one figure on the
 * page that can fall.
 */
function Momentum({ report }: { report: FunnelReport }) {
  const { current, previous, change } = report.momentum;
  if (current === 0 && previous === 0) return null;

  return (
    <p className="small">
      <strong>{current.toLocaleString()}</strong> invited in the last 7 days
      {change === null ? (
        // No baseline is not "up 100%". Dividing by a week that sent nothing
        // invents a percentage out of an empty denominator.
        <span className="subtle"> · first week of sending</span>
      ) : (
        <span className={change >= 0 ? "positive-text" : "muted"}>
          {" "}
          · {change >= 0 ? "+" : ""}
          {Math.round(change * 100)}% on the week before
        </span>
      )}
    </p>
  );
}

/**
 * A rate, or the reason there is not one yet.
 *
 * "Too early" is a state of its own and never a styling of "below": a rep with
 * four invitations out has not failed, and rendering 0% against a 30% target
 * on somebody's first morning is this product calling a working account broken.
 */
export function RateTile({ label, rate }: { label: string; rate: Rate }) {
  if (rate.verdict === "too-early") {
    return (
      <div className="card tight stat">
        <span className="stat-label">{label}</span>
        <span className="stat-value subtle">—</span>
        <span className="stat-note">
          {rate.denominator.toLocaleString()} so far. A rate appears at{" "}
          {/* Named, so "nothing here yet" has an end somebody can see. */}
          {rate.denominator === 0 ? "the first ten" : "ten"}.
        </span>
      </div>
    );
  }

  const value = rate.value ?? 0;
  const met = rate.verdict === "on-target";
  // Both bars share a scale running to twice the target, so acceptance and
  // reply can be read against each other rather than each against itself.
  const width = Math.min(100, (value / (rate.target * 2)) * 100);

  return (
    <div className="card tight stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{(value * 100).toFixed(1)}%</span>
      <div aria-hidden="true" className={`meter vs-target ${met ? "is-met" : "is-short"}`}>
        <span style={{ width: `${width}%` }} />
        <div className="meter-tick" />
      </div>
      <span className="stat-note">
        {rate.numerator.toLocaleString()} of {rate.denominator.toLocaleString()} ·{" "}
        {met ? "on target" : "below"} {(rate.target * 100).toFixed(0)}%
      </span>
    </div>
  );
}
