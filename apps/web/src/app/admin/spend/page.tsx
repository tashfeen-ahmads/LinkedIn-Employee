import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, formatUsd, when } from "@/lib/admin";
import { formatSpend } from "@/lib/spend-display";
import { PageHeader, Section, Empty, LoadFailed } from "@/components/page";
import { Kpi, RankedBars, TrendChart } from "@/components/charts";

export const dynamic = "force-dynamic";

/**
 * What the agents cost, and where they fail.
 *
 * Summed in the database (`platform_spend_breakdown`), because `llm_calls` gains
 * a row per agent call and a page that read it row by row stopped at the
 * thousandth and reported a bill that was quietly short. A model missing from
 * the price table is counted as unpriced, never as free.
 */
export default async function AdminSpendPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: rows, error }, { data: byWorkspace }, { data: workspaces }, { data: failures }] = await Promise.all([
    supabase.rpc("platform_spend_breakdown", { p_days: 30 }),
    supabase.rpc("platform_workspace_spend"),
    supabase.from("workspaces").select("id, name"),
    supabase
      .from("llm_calls")
      .select("id, workspace_id, agent, model, error, created_at")
      .not("error", "is", null)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const all = rows ?? [];
  const total = all.reduce((sum, r) => sum + Number(r.spend_usd), 0);
  const calls = all.reduce((sum, r) => sum + Number(r.calls), 0);
  const failed = all.reduce((sum, r) => sum + Number(r.failed), 0);
  const unpriced = all.reduce((sum, r) => sum + Number(r.unpriced), 0);

  // Every day in the window keeps its slot, so a quiet weekend reads as quiet
  // rather than being joined to the days either side of it.
  const daily = new Map<string, number>();
  for (let i = 29; i >= 0; i -= 1) daily.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
  for (const r of all) {
    const day = String(r.day).slice(0, 10);
    if (daily.has(day)) daily.set(day, (daily.get(day) ?? 0) + Number(r.spend_usd));
  }

  const byAgent = new Map<string, { spend: number; calls: number; failed: number; unpriced: number }>();
  const byModel = new Map<string, { spend: number; calls: number; unpriced: number }>();
  for (const r of all) {
    const a = byAgent.get(r.agent) ?? { spend: 0, calls: 0, failed: 0, unpriced: 0 };
    a.spend += Number(r.spend_usd);
    a.calls += Number(r.calls);
    a.failed += Number(r.failed);
    a.unpriced += Number(r.unpriced);
    byAgent.set(r.agent, a);
    const m = byModel.get(r.model) ?? { spend: 0, calls: 0, unpriced: 0 };
    m.spend += Number(r.spend_usd);
    m.calls += Number(r.calls);
    m.unpriced += Number(r.unpriced);
    byModel.set(r.model, m);
  }

  const names = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const topWorkspaces = [...(byWorkspace ?? [])].sort((a, b) => Number(b.spend_usd) - Number(a.spend_usd)).slice(0, 15);

  return (
    <>
      <PageHeader title="AI spend" lede="The last 30 days of agent calls, by day, agent and model. Customers never see this." />

      <Section title="Last 30 days">
        <div className="kpi-row">
          {/* A floor whenever any call was unpriced: those are excluded from
              the sum, never counted as free, and the per-call figure divides
              by the calls that were actually priced. */}
          <Kpi label="Spend" value={formatSpend(total, calls, unpriced)} />
          <Kpi
            label="Calls"
            value={calls.toLocaleString()}
            note={calls - unpriced > 0 ? `${formatUsd(total / (calls - unpriced))} a priced call` : undefined}
          />
          <Kpi label="Failed" value={failed.toLocaleString()} tone={failed ? "warning" : "neutral"} note={calls ? `${((failed / calls) * 100).toFixed(1)}% of calls` : undefined} />
          <Kpi label="Unpriced" value={unpriced.toLocaleString()} tone={unpriced ? "warning" : "neutral"} note="model missing from the price table, so excluded rather than counted as free" />
        </div>
        <TrendChart label="Spend per day, USD" points={[...daily.entries()].map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))} />
      </Section>

      <Section title="By agent">
        {byAgent.size ? (
          <RankedBars
            data={[...byAgent.entries()]
              .sort((a, b) => b[1].spend - a[1].spend)
              .map(([agent, v]) => ({
                label: agent,
                value: Math.round(v.spend * 100) / 100,
                note: `${formatSpend(v.spend, v.calls, v.unpriced)} · ${v.calls.toLocaleString()} calls${v.failed ? ` · ${v.failed} failed` : ""}`,
              }))}
          />
        ) : error ? (
          <LoadFailed what="AI spend" />
        ) : (
          <Empty title="No calls yet.">Agent calls appear here as soon as one runs.</Empty>
        )}
      </Section>

      <Section title="By model">
        <div className="table-scroll card-rows">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Calls</th>
                <th className="num">Spend</th>
                <th className="num">Unpriced</th>
              </tr>
            </thead>
            <tbody>
              {[...byModel.entries()]
                .sort((a, b) => b[1].spend - a[1].spend)
                .map(([model, v]) => (
                  <tr key={model}>
                    <td data-label="Model" className="small mono">{model}</td>
                    <td data-label="Calls" className="num mono">{v.calls.toLocaleString()}</td>
                    <td data-label="Spend" className="num mono">{formatSpend(v.spend, v.calls, v.unpriced)}</td>
                    <td data-label="Unpriced" className="num mono">{v.unpriced}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="By workspace, all time">
        <div className="table-scroll card-rows">
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th className="num">Calls</th>
                <th className="num">Spend</th>
              </tr>
            </thead>
            <tbody>
              {topWorkspaces.map((w) => (
                <tr key={w.workspace_id}>
                  <td data-label="Workspace">
                    <Link href={`/admin/workspaces/${w.workspace_id}`}>{names.get(w.workspace_id) ?? "—"}</Link>
                  </td>
                  <td data-label="Calls" className="num mono">{Number(w.calls).toLocaleString()}</td>
                  <td data-label="Spend" className="num mono">
                    {formatSpend(Number(w.spend_usd), Number(w.calls), Number(w.calls) - Number(w.priced_calls))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {failures?.length ? (
        <Section title="Failed calls" description="The most recent 25. A refusal or a schema failure here is a draft, a note or a strategy that never appeared.">
          <div className="table-scroll card-rows">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Workspace</th>
                  <th>Agent</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td data-label="When" className="small subtle">{when(f.created_at)}</td>
                    <td data-label="Workspace" className="small">
                      {f.workspace_id ? <Link href={`/admin/workspaces/${f.workspace_id}`}>{names.get(f.workspace_id) ?? "—"}</Link> : "—"}
                    </td>
                    <td data-label="Agent" className="small">
                      {f.agent} <span className="tiny subtle mono">{f.model}</span>
                    </td>
                    <td data-label="Error" className="small muted">{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </>
  );
}
