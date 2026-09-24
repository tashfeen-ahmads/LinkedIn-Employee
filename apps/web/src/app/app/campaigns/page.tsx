import Link from "next/link";
import { Empty, PageHeader } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/rows";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildCampaign, eligibleProspects } from "@/lib/build-campaign";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { SubmitButton } from "@/components/submit-button";
import { PageNotice, type NoticeParams } from "@/components/page-notice";

/**
 * One campaign over everybody you have, in one click.
 *
 * The first version of this was a form: name it, pick the goal, pick the
 * agent, set the follow-up, tick two hundred checkboxes. Every one of those
 * has a sensible answer already — the workspace has one agent, one LinkedIn
 * account and a list of people nobody has written to — so the form was asking
 * a rep to confirm what the product already knew.
 *
 * It still arrives as a draft. Nothing sends until somebody has read the names
 * and the copy and pressed Launch, which is the review this product is built
 * on; a button that skipped it would be a way around it.
 */
async function startCampaign() {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: account }, { data: agent }, prospects] = await Promise.all([
    supabase
      .from("linkedin_accounts")
      .select("id")
      .eq("workspace_id", session.workspaceId)
      .eq("status", "active")
      .limit(1),
    supabase
      .from("agents")
      .select("id")
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .limit(1),
    eligibleProspects(supabase as never, session.workspaceId),
  ]);

  if (!account?.[0]) {
    redirect(errorQuery("/app/campaigns", "Connect a LinkedIn account first — a campaign sends from one."));
  }
  if (prospects.length === 0) {
    redirect(errorQuery("/app/campaigns", "Everyone here has already been contacted. Run a strategy to find more."));
  }

  const result = await buildCampaign(supabase as never, {
    workspaceId: session.workspaceId,
    userId: session.userId,
    name: `Outreach — ${new Date().toISOString().slice(0, 10)}`,
    accountId: account[0].id,
    // Null is a real answer: a workspace whose agent has not been seeded yet
    // still gets a campaign, on the behaviour every campaign had before agents.
    agentId: agent?.[0]?.id ?? null,
    ctaId: null,
    prospectIds: prospects.map((p) => p.id),
    followUpDays: 3,
  });

  if (!result.ok) redirect(errorQuery("/app/campaigns", result.reason ?? "The campaign could not be built."));
  revalidatePath("/app/campaigns");
  redirect(
    noticeQuery(
      `/app/campaigns/${result.campaignId}`,
      `${prospects.length} people queued as a draft. Read the notes before you launch.`,
    ),
  );
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<NoticeParams>;
}) {
  const notice = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: campaigns }, counts, { data: strategies }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, name, status, connection_note, daily_invite_cap, reply_mode, launched_at, created_at, customer_profile_id",
      )
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false }),
    // Paged, because these rows are counted rather than shown: a plain select
    // stops at PostgREST's thousandth row without saying so, and a campaign
    // grown past that with `Find more` would report a queue smaller than it is
    // — which reads as the campaign having nearly finished.
    fetchAllRows<{ campaign_id: string; status: string }>((from, to) =>
      supabase
        .from("campaign_prospects")
        .select("campaign_id, status")
        .eq("workspace_id", session.workspaceId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("customer_profiles")
      .select("id, name, priority")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
  ]);

  const byCampaign = new Map<string, { queued: number; total: number }>();
  for (const row of counts.rows) {
    const entry = byCampaign.get(row.campaign_id) ?? { queued: 0, total: 0 };
    entry.total += 1;
    if (row.status === "queued") entry.queued += 1;
    byCampaign.set(row.campaign_id, entry);
  }

  if (!campaigns?.length) {
    return (
      <>
        <PageHeader
          eyebrow="Pipeline"
          title="Campaigns"
          lede="Built as drafts. You read every name and every message before anything sends."
          actions={
            <form action={startCampaign}>
              <SubmitButton className="btn secondary" pendingLabel="Building…">
                Start a campaign
              </SubmitButton>
            </form>
          }
        />
        {/* Without this, a refusal from the action above redirects here and
            says nothing — a button that looks broken rather than one that
            explained itself. */}
        <PageNotice error={notice.error} notice={notice.notice} />
        <Empty title="No campaigns yet." action="Open strategies" href="/app/strategy">
          The Targeting Agent builds one from an approved strategy — the list, the copy, and a note
          written for each person. Or press <strong>Start a campaign</strong> above to build one now
          over everybody you already have. Either way it arrives as a draft.
        </Empty>
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
      <PageHeader
        eyebrow="Pipeline"
        title="Campaigns"
        lede="Grouped by the strategy each came from, in the strategies' own priority order."
        actions={
          <Link className="btn ghost small" href="/app/analytics">
            Results
          </Link>
        }
      />
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
