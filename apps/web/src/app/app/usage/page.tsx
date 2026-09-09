import { formatUsd } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { costPerMeeting, groupBy, type UsageGroup, type UsageRow } from "@/lib/usage";

/**
 * What the agents cost, and what a booked meeting costs to produce.
 *
 * Every model call has been recorded since the first commit — tokens, latency,
 * prompt version, errors — and nothing ever read the table. A per-seat product
 * whose margin depends on model spend could not see its own margin.
 */

const DAYS = 30;

export default async function UsagePage() {
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return (
      <>
        <h1 style={{ fontSize: "1.6rem" }}>Usage</h1>
        <p className="muted">Spend is visible to the workspace owner and admins.</p>
      </>
    );
  }

  const supabase = await createClient();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const [{ data: calls }, { count: meetings }] = await Promise.all([
    supabase
      .from("llm_calls")
      .select("agent, model, prompt_version, input_tokens, output_tokens, cache_read_tokens, latency_ms, cost_usd, error, created_at")
      .eq("workspace_id", session.workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId)
      .gte("created_at", since),
  ]);

  const rows = (calls ?? []) as UsageRow[];

  if (rows.length === 0) {
    return (
      <>
        <h1 style={{ fontSize: "1.6rem" }}>Usage</h1>
        <p className="muted">
          No model calls in the last {DAYS} days. This page fills in once a campaign runs.
        </p>
      </>
    );
  }

  const total = groupBy(rows, () => "all")[0]!;
  const byAgent = groupBy(rows, (row) => row.agent);
  const byVersion = groupBy(rows, (row) => `${row.agent} · ${row.prompt_version ?? "unversioned"}`);
  const perMeeting = costPerMeeting(total.costUsd, meetings ?? 0);
  const failures = rows.filter((row) => row.error).slice(0, 10);

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Usage</h1>
      <p className="small muted" style={{ maxWidth: "62ch" }}>
        The last {DAYS} days, priced at the published list rates. Costs are an estimate from recorded
        tokens, not an invoice.
      </p>

      <section
        style={{
          display: "grid",
          gap: "0.75rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          margin: "1.5rem 0 2.5rem",
        }}
      >
        <Stat label={`Spend, ${DAYS} days`} value={formatUsd(total.costUsd)} />
        <Stat
          label="Per booked meeting"
          value={perMeeting === null ? "—" : formatUsd(perMeeting)}
          note={meetings ? `${meetings} booked` : "no meetings yet"}
        />
        <Stat label="Calls" value={total.calls.toLocaleString()} note={total.failed ? `${total.failed} failed` : "none failed"} />
        <Stat
          label="From cache"
          value={total.cacheHitRate === null ? "—" : `${Math.round(total.cacheHitRate * 100)}%`}
          note="of input tokens"
        />
      </section>

      <UsageTable title="By agent" groups={byAgent} firstColumn="Agent" />
      <UsageTable title="By prompt version" groups={byVersion} firstColumn="Prompt" />

      {failures.length ? (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.15rem" }}>Recent failures</h2>
          <div className="table-scroll" style={{ marginTop: "1rem" }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Agent</th>
                  <th>What went wrong</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((row, index) => (
                  <tr key={index}>
                    <td className="small muted">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="small">{row.agent}</td>
                    <td className="small muted">{row.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function UsageTable({
  title,
  groups,
  firstColumn,
}: {
  title: string;
  groups: UsageGroup[];
  firstColumn: string;
}) {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.15rem" }}>{title}</h2>
      <div className="table-scroll" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>{firstColumn}</th>
              <th style={{ textAlign: "right" }}>Cost</th>
              <th style={{ textAlign: "right" }}>Calls</th>
              <th style={{ textAlign: "right" }}>Cached</th>
              <th style={{ textAlign: "right" }}>Median</th>
              <th style={{ textAlign: "right" }}>Failed</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <td className="small">{group.key}</td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {formatUsd(group.costUsd)}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {group.calls.toLocaleString()}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {group.cacheHitRate === null ? "—" : `${Math.round(group.cacheHitRate * 100)}%`}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {group.medianLatencyMs === null ? "—" : `${(group.medianLatencyMs / 1000).toFixed(1)}s`}
                </td>
                <td className="mono" style={{ textAlign: "right", color: group.failed ? "var(--warning)" : undefined }}>
                  {group.failed || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card">
      <p className="small muted" style={{ margin: 0 }}>
        {label}
      </p>
      <p className="mono" style={{ fontSize: "1.6rem", fontWeight: 640, margin: "0.2rem 0 0" }}>
        {value}
      </p>
      {note ? (
        <p className="small muted" style={{ margin: 0 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
