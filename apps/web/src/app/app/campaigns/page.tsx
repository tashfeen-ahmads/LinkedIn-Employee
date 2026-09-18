import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

export default async function CampaignsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: campaigns }, { data: counts }, { data: strategies }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, name, status, connection_note, daily_invite_cap, reply_mode, launched_at, created_at, customer_profile_id",
      )
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false }),
    supabase.from("campaign_prospects").select("campaign_id, status").eq("workspace_id", session.workspaceId),
    supabase
      .from("customer_profiles")
      .select("id, name, priority")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
  ]);

  const byCampaign = new Map<string, { queued: number; total: number }>();
  for (const row of counts ?? []) {
    const entry = byCampaign.get(row.campaign_id) ?? { queued: 0, total: 0 };
    entry.total += 1;
    if (row.status === "queued") entry.queued += 1;
    byCampaign.set(row.campaign_id, entry);
  }

  if (!campaigns?.length) {
    return (
      <>
        <div className="page-head">
          <h1>Campaigns</h1>
          <p className="muted">
            None yet. The Targeting Agent creates one as a draft; you review the list and the copy before
            anything is sent.
          </p>
        </div>
      </>
    );
  }

  // Grouped by the strategy each campaign was built from.
  //
  // A business runs fifteen or twenty strategies and several campaigns under
  // each — a different angle, a different week, a different list. Flat and
  // sorted by date they interleave, and the question the list exists to answer
  // ("what am I running for the agencies market") cannot be read off it at all.
  //
  // Order follows the strategies' own priority, which is the order the
  // Strategy page ranks them in: two screens disagreeing about which market
  // matters most is a small thing that costs trust every time it is noticed.
  const strategyOrder = strategies ?? [];
  const grouped = strategyOrder
    .map((s) => ({
      id: s.id as string | null,
      name: s.name as string,
      campaigns: campaigns.filter((c) => c.customer_profile_id === s.id),
    }))
    .filter((group) => group.campaigns.length > 0);

  // Campaigns whose strategy was deleted still have to appear. A campaign that
  // is running and invisible is the worst row on this page.
  const orphaned = campaigns.filter((c) => !strategyOrder.some((s) => s.id === c.customer_profile_id));
  if (orphaned.length) {
    grouped.push({ id: null, name: "No strategy", campaigns: orphaned });
  }

  return (
    <>
      <h1>Campaigns</h1>
      {grouped.map((group) => (
        <section key={group.id ?? "none"} className="stack-4">
          <div className="between">
            <h2>{group.name}</h2>
            <p className="tiny subtle">
              {group.campaigns.length} {group.campaigns.length === 1 ? "campaign" : "campaigns"}
              {group.id ? (
                <>
                  {" · "}
                  <Link href={`/app/prospects?strategy=${group.id}`}>see its prospects</Link>
                </>
              ) : null}
            </p>
          </div>
          <div className="grid">
            {renderCampaigns(group.campaigns, byCampaign)}
          </div>
        </section>
      ))}
    </>
  );
}

function renderCampaigns(
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    daily_invite_cap: number;
    reply_mode: string;
    launched_at: string | null;
    connection_note: string;
  }>,
  byCampaign: Map<string, { queued: number; total: number }>,
) {
  return (
    <>
      {campaigns.map((campaign) => {
          const stats = byCampaign.get(campaign.id) ?? { queued: 0, total: 0 };
          return (
            <article key={campaign.id} className="card">
              <header className="between">
                <div>
                  <h3>{campaign.name}</h3>
                  <p className="small muted">
                    {stats.total} prospects, {stats.queued} still queued · {campaign.daily_invite_cap} invites
                    a day ·{" "}
                    {campaign.reply_mode === "autopilot" ? "replies on autopilot" : "replies need approval"}
                  </p>
                </div>
                <div className="cluster top">
                  <span className={`pill ${campaign.status === "running" ? "positive" : ""}`}>
                    {campaign.status}
                  </span>
                  {/* Launching happens on the review page and nowhere else: it
                      is the one action that reaches strangers, and it should
                      not be possible without having seen the list and the
                      four messages. */}
                  <Link className="btn secondary small" href={`/app/campaigns/${campaign.id}`}>
                    {campaign.status === "draft" ? "Review" : "Open"}
                  </Link>
                </div>
              </header>
              <p
                className="small panel"
              >
                {campaign.connection_note}
              </p>
            </article>
        );
      })}
    </>
  );
}
