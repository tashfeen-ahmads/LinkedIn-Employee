import { formatUsd } from "@le/shared";
import { PageHeader } from "@/components/page";
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

export async function SpendSection() {
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return (
      <>
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

      <section className="grid tight grid-4">
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
        <section>
          <h2>Recent failures</h2>
          <div className="table-scroll">
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
    <section>
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{firstColumn}</th>
              <th className="num">Cost</th>
              <th className="num">Calls</th>
              <th className="num">Cached</th>
              <th className="num">Median</th>
              <th className="num">Failed</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <td className="small">{group.key}</td>
                <td className="mono num">
                  {formatUsd(group.costUsd)}
                </td>
                <td className="mono num">
                  {group.calls.toLocaleString()}
                </td>
                <td className="mono num">
                  {group.cacheHitRate === null ? "—" : `${Math.round(group.cacheHitRate * 100)}%`}
                </td>
                <td className="mono num">
                  {group.medianLatencyMs === null ? "—" : `${(group.medianLatencyMs / 1000).toFixed(1)}s`}
                </td>
                <td className={`mono num${group.failed ? " warning-text" : ""}`}>
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
      <p className="small muted">
        {label}
      </p>
      <p className="mono stat-value">
        {value}
      </p>
      {note ? (
        <p className="small muted">
          {note}
        </p>
      ) : null}
    </div>
  );
}
