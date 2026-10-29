import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, hiddenWorkspaces, shown, when } from "@/lib/admin";
import { PageHeader, Section, LoadFailed } from "@/components/page";
import { FunnelChart } from "@/components/charts";
import { BILLING_STATE_LABEL, customerFunnel, type BillingState } from "@/lib/customer-funnel";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

/** The order the billing states are listed in: money first, then the people who could become money. */
const BILLING_ORDER: BillingState[] = [
  "paying",
  "subscribed_in_trial",
  "cancelling",
  "past_due",
  "trial",
  "trial_ended",
  "cancelled",
  "free",
];

/**
 * The customer funnel: from signing up to paying, per workspace.
 *
 * Every stage is something a workspace did, read from rows the console may
 * already see (rule 15: workspaces, accounts, campaigns, events), never from
 * prospects or messages. Hidden workspaces are left out (migration 0062).
 */
export default async function AdminFunnelPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: rangeParam } = await searchParams;
  await requirePlatformAdmin();
  const supabase = await createClient();
  const range = RANGES.find((r) => r.key === rangeParam) ?? RANGES[0];

  // Every row, a thousand at a time: PostgREST caps a read at 1,000 rows, and a
  // funnel read from an arbitrary first thousand is a funnel that is wrong.
  const all = async <T,>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await read(from, from + 999);
      if (error) return { data: null, error };
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) return { data: rows, error: null };
    }
  };
  const [{ data: workspaces, error }, { data: accounts }, { data: campaigns }, { data: replies }, hidden] = await Promise.all([
    all((from, to) =>
      supabase
        .from("workspaces")
        .select("id, name, created_at, plan, trial_ends_at, subscription_status, billing_interval, cancel_at_period_end, stripe_subscription_id")
        .order("id")
        .range(from, to),
    ),
    all((from, to) => supabase.from("linkedin_accounts").select("workspace_id, provider_account_id, first_action_at").order("id").range(from, to)),
    all((from, to) => supabase.from("campaigns").select("workspace_id, launched_at").order("id").range(from, to)),
    all((from, to) => supabase.from("events").select("workspace_id").eq("name", "message.received").order("id").range(from, to)),
    hiddenWorkspaces(),
  ]);

  const visible = shown(workspaces, hidden, "id");
  const now = new Date();
  const facts = {
    workspaces: visible,
    accounts: shown(accounts, hidden),
    campaigns: shown(campaigns, hidden),
    replied: new Set((replies ?? []).map((r) => r.workspace_id).filter((id): id is string => Boolean(id))),
  };
  // The funnel is the cohort that signed up in the period; revenue and billing
  // are where every workspace stands today, whenever it signed up.
  const funnel = customerFunnel(facts, now, range.days);
  const current = customerFunnel(facts, now, null);
  const names = new Map(visible.map((w) => [w.id, w.name]));
  const paying = current.billing.paying + current.billing.cancelling + current.billing.past_due;

  return (
    <>
      <PageHeader
        title="Funnel"
        lede="How workspaces move from signing up to paying, and where the money is."
        actions={
          <nav className="form-row" aria-label="Period">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={`/admin/funnel?range=${r.key}`}
                className={`btn small${r.key === range.key ? "" : " ghost"}`}
                aria-current={r.key === range.key ? "page" : undefined}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        }
      />

      {error ? (
        <LoadFailed what="Workspaces" />
      ) : (
        <>
          <Section title="Revenue">
            <dl className="console-stats" aria-label="Revenue">
              <div className="console-stat">
                <dt>Monthly revenue</dt>
                <dd className="console-stat-value">${current.mrr.toLocaleString()}</dd>
                <dd className="console-stat-note">All paying workspaces, yearly plans as a twelfth</dd>
              </div>
              <div className="console-stat">
                <dt>Paying</dt>
                <dd className="console-stat-value">{paying}</dd>
                <dd className="console-stat-note">{current.billing.subscribed_in_trial} more chose a plan and are still in their trial</dd>
              </div>
              <div className="console-stat">
                <dt>On a trial</dt>
                <dd className="console-stat-value">{current.billing.trial}</dd>
                <dd className="console-stat-note">{current.endingSoon.length} end in the next 7 days</dd>
              </div>
              <div className="console-stat">
                <dt>Trial ended, no plan</dt>
                <dd className={`console-stat-value${current.billing.trial_ended ? " is-warning" : ""}`}>{current.billing.trial_ended}</dd>
                <dd className="console-stat-note">Sending is paused until they choose</dd>
              </div>
            </dl>
          </Section>

          <Section
            title={`From sign-up to paying, ${range.label.toLowerCase()}`}
            description="Each bar is workspaces that signed up in this period and reached that stage, with the share of the stage above."
          >
            <FunnelChart steps={funnel.steps} />
          </Section>

          <Section title="Where every workspace stands">
            <div className="table-scroll card-rows">
              <table>
                <thead>
                  <tr>
                    <th>Billing</th>
                    <th className="num">Workspaces</th>
                  </tr>
                </thead>
                <tbody>
                  {BILLING_ORDER.map((state) => (
                    <tr key={state}>
                      <td>{BILLING_STATE_LABEL[state]}</td>
                      <td className="num nums" data-label="Workspaces">
                        {current.billing[state]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="Trials ending this week"
            description="No plan chosen yet. Their sending pauses when the trial ends."
          >
            {current.endingSoon.length ? (
              <ul className="stack-2">
                {current.endingSoon.map((t) => (
                  <li key={t.id} className="form-row">
                    <Link href={`/admin/workspaces/${t.id}`}>{names.get(t.id) ?? "Workspace"}</Link>
                    <span className="small muted">ends {when(t.endsAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">None this week.</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}
