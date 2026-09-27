import Link from "next/link";
import { Empty, PageHeader, Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/rows";
import { PageNotice, type NoticeParams } from "@/components/page-notice";

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
            <Link className="btn" href="/app/campaigns/new">
              Set up a campaign
            </Link>
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
        /*
          `Section`, not a hand-rolled `<section className="stack-4">`.
          The count belongs on the heading's own row, which is what
          `Section`'s `action` slot is for — written by hand it was a
          `.between` div inside a stack, so the heading picked up the stack's
          gap *and* the extra margin this sheet gives whatever follows an h2.
          Every group on this screen therefore sat a few pixels differently
          from every framed section elsewhere in the product.
        */
        <Section
          key={group.id ?? "none"}
          title={group.name}
          action={
            <p className="tiny subtle">
              {group.campaigns.length} {group.campaigns.length === 1 ? "campaign" : "campaigns"}
              {group.id ? (
                <>
                  {" · "}
                  <Link href={`/app/prospects?strategy=${group.id}`}>see its prospects</Link>
                </>
              ) : null}
            </p>
          }
        >
          <div className="grid">{renderCampaigns(group.campaigns, byCampaign)}</div>
        </Section>
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
              {/*
                A panel is a box drawn around something. With no note there is
                nothing to draw it around, and every campaign on this screen
                carried an empty sunken rectangle where its opening line should
                be — which reads as a card that failed to load rather than as a
                campaign whose copy has not been written.

                A campaign without one is also worth saying out loud: the note
                is what the stranger actually reads, so "not written yet" is a
                fact about the campaign, not an empty space.
              */}
              {campaign.connection_note ? (
                <p className="small panel">{campaign.connection_note}</p>
              ) : (
                <p className="small subtle">
                  No opening line yet — it is written for each person when the list is built.
                </p>
              )}
            </article>
        );
      })}
    </>
  );
}
