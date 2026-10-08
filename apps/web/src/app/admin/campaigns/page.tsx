import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago } from "@/lib/admin";
import { PageHeader, Section, Empty } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { ControlButton } from "@/components/admin-control";
import { label } from "@/lib/labels";

export const dynamic = "force-dynamic";

const STATUSES = ["running", "paused", "draft", "completed", "archived"] as const;
const CONTACTED = ["invited", "accepted", "messaged_1", "messaged_2", "messaged_3", "replied", "positive", "negative", "meeting_booked"];
const REPLIED = ["replied", "positive", "negative", "meeting_booked"];
const ACCEPTED = ["accepted", "messaged_1", "messaged_2", "messaged_3", ...REPLIED];

/**
 * Every campaign on the platform, with where its people have got to.
 *
 * Counts by status and never names: `campaign_prospects` says who is in a
 * campaign, and rule 15 keeps that off the console. Pausing is here; launching
 * is not — a campaign leaves draft on its owner's yes and nobody else's.
 */
export default async function AdminCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: campaigns }, { data: stats }, { data: workspaces }, { data: accounts }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, workspace_id, name, status, launched_at, created_at, linkedin_account_id, daily_invite_cap")
      .order("created_at", { ascending: false }),
    supabase.rpc("platform_campaign_stats"),
    supabase.from("workspaces").select("id, name"),
    supabase.from("linkedin_accounts").select("id, status"),
  ]);

  const workspaceName = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const accountStatus = new Map((accounts ?? []).map((a) => [a.id, a.status]));
  const counts = new Map<string, Record<string, number>>();
  for (const row of stats ?? []) {
    const c = counts.get(row.campaign_id) ?? {};
    c[row.status] = Number(row.people);
    counts.set(row.campaign_id, c);
  }
  const sum = (c: Record<string, number>, keys: string[]) => keys.reduce((n, k) => n + (c[k] ?? 0), 0);

  const filter = STATUSES.find((s) => s === params.status);
  const shown = (campaigns ?? []).filter((c) => !filter || c.status === filter);
  const back = "/admin/campaigns";

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title="Campaigns"
        lede={`${campaigns?.length ?? 0} across every workspace. Pause any running campaign; resume one its owner launched.`}
      />
      <PageNotice error={params.error} notice={params.notice} />

      <div className="cluster">
        <Link
          className={`btn small ${filter ? "ghost" : "secondary"}`}
          href="/admin/campaigns"
          aria-current={filter ? undefined : "page"}
        >
          All ({campaigns?.length ?? 0})
        </Link>
        {STATUSES.map((status) => {
          const n = (campaigns ?? []).filter((c) => c.status === status).length;
          if (!n) return null;
          return (
            <Link
              key={status}
              className={`btn small ${filter === status ? "secondary" : "ghost"}`}
              href={`/admin/campaigns?status=${status}`}
              aria-current={filter === status ? "page" : undefined}
            >
              {label(status)} ({n})
            </Link>
          );
        })}
      </div>

      <Section title={filter ? `${label(filter)} (${shown.length})` : "Every campaign"}>
        {!shown.length ? (
          <Empty title="None.">No campaign has this status.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="num">People</th>
                  <th className="num">Waiting</th>
                  <th className="num">Contacted</th>
                  <th className="num">Accepted</th>
                  <th className="num">Replied</th>
                  <th className="num">Failed</th>
                  <th>Launched</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const n = counts.get(c.id) ?? {};
                  const total = Object.values(n).reduce((a, b) => a + b, 0);
                  const account = accountStatus.get(c.linkedin_account_id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <span className="small">{c.name}</span>
                        <p className="tiny subtle">
                          <Link href={`/admin/workspaces/${c.workspace_id}`}>{workspaceName.get(c.workspace_id) ?? "—"}</Link>
                          {c.status === "running" && account !== "active" ? (
                            <span className="pill tiny danger"> account {account ? label(account).toLowerCase() : "missing"}</span>
                          ) : null}
                        </p>
                      </td>
                      <td>
                        <span
                          className={`pill tiny ${c.status === "running" ? "positive" : c.status === "paused" ? "warning" : "plain"}`}
                        >
                          {label(c.status)}
                        </span>
                      </td>
                      <td className="num mono">{total}</td>
                      <td className="num mono">{n.queued ?? 0}</td>
                      <td className="num mono">{sum(n, CONTACTED)}</td>
                      <td className="num mono">{sum(n, ACCEPTED)}</td>
                      <td className="num mono">{sum(n, REPLIED)}</td>
                      <td className="num mono">{n.failed ?? 0}</td>
                      <td className="small subtle">{c.launched_at ? ago(c.launched_at) : "never"}</td>
                      <td>
                        {c.status === "running" ? (
                          <ControlButton op="campaign-pause" fields={{ campaignId: c.id }} back={back} label="Pause" tone="ghost" />
                        ) : c.status === "paused" && c.launched_at ? (
                          <ControlButton op="campaign-resume" fields={{ campaignId: c.id }} back={back} label="Resume" tone="ghost" />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
