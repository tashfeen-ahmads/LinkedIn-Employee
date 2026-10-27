import Link from "next/link";
import { Empty, PageHeader, Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/rows";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { actionableQueue, type QueuedRow } from "@/lib/campaign";
import { countFunnel, type FunnelRow } from "@le/shared";
import { campaignCtas } from "@/lib/campaign-cta";
import { CampaignCard, type CampaignCardData } from "@/components/campaign-card";
import { setStatus } from "./[id]/actions";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: campaigns }, counts, { data: strategies }, { data: businesses }, { data: exclusionRows }, { data: held }, { data: viewer }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, name, status, connection_note, daily_invite_cap, reply_mode, launched_at, created_at, customer_profile_id, cta_id, cta_kind, cta_label, cta_url",
      )
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false }),
    // Paged, because these rows are counted rather than shown: a plain select
    // stops at PostgREST's thousandth row without saying so, and a campaign
    // grown past that with `Find more` would report a queue smaller than it is
    // — which reads as the campaign having nearly finished.
    // With the prospect fields the send path checks, so "still queued" leaves
    // out the people it will close rather than invite (see `actionableQueue`).
    // The embed is cast, as on the campaign page: the generated types carry no
    // relationships, so the join reads as an error type it is not.
    // With when each person accepted and replied, so each card's tiles are
    // the same funnel the campaign's own overview draws (`countFunnel`).
    fetchAllRows<{ campaign_id: string } & FunnelRow & QueuedRow>(
      (from, to) =>
        supabase
          .from("campaign_prospects")
          .select("campaign_id, status, invited_at, accepted_at, replied_at, prospect:prospects (do_not_contact, last_contacted_at, company, linkedin_url)")
          .eq("workspace_id", session.workspaceId)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: Array<{ campaign_id: string } & FunnelRow & QueuedRow> | null;
          error: { message: string } | null;
        }>,
    ),
    supabase
      .from("customer_profiles")
      .select("id, name, priority, business_profile_id")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    // Which business each strategy belongs to, for a workspace running more
    // than one. A campaign for the cleaning company and one for the estate
    // agency sat side by side with nothing on the screen telling them apart,
    // and both are addressed under the same rep's name.
    supabase
      .from("business_profiles")
      .select("id, spec, website_url")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: true }),
    supabase.from("exclusions").select("kind, value, raw_value, reason").eq("workspace_id", session.workspaceId),
    // Conversations held for a person, per campaign: the card's "needs you"
    // line counts the same holds the inbox lists (rule 10), never drafts.
    supabase
      .from("conversations")
      .select("campaign_id, needs_human_kind")
      .eq("workspace_id", session.workspaceId)
      .eq("needs_human", true),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);

  const exclusions = (exclusionRows ?? []).map((row) => ({
    kind: row.kind,
    value: row.value,
    rawValue: row.raw_value,
    reason: row.reason,
  }));

  const byCampaign = new Map<string, { queued: number; total: number; failed: number; rows: FunnelRow[] }>();
  for (const row of counts.rows) {
    const entry = byCampaign.get(row.campaign_id) ?? { queued: 0, total: 0, failed: 0, rows: [] };
    entry.total += 1;
    entry.rows.push(row);
    if (row.status === "queued") entry.queued += actionableQueue([row], exclusions).actionable;
    if (row.status === "failed") entry.failed += 1;
    byCampaign.set(row.campaign_id, entry);
  }
  const heldBy = new Map<string, number>();
  for (const row of held ?? []) {
    if (row.campaign_id) heldBy.set(row.campaign_id, (heldBy.get(row.campaign_id) ?? 0) + 1);
  }

  if (!campaigns?.length) {
    return (
      <>
        <PageHeader
          eyebrow="Work"
          title="Campaigns"
          lede="Built as drafts. You read every name and every message before anything sends."
          actions={
            <Link className="btn" href="/app/campaigns/new">
              Set up a campaign
            </Link>
          }
        />
        {/* Without this, a refusal from the action above redirects here and
            says nothing: a button that looks broken rather than one that
            explained itself. */}
        <PageNotice error={notice.error} notice={notice.notice} />
        <Empty title="No campaigns yet." action="Open strategies" href="/app/strategy">
          Scout and Quinn build one from an approved strategy: the list, the copy, and a note
          written for each person. Or press <strong>Set up a campaign</strong> above to build one now
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

  /*
   * Which business a group belongs to, named only when there is more than one.
   *
   * `spec.companyName` rather than a column: the name is already a field on the
   * profile the agent wrote, and a second place to store it is a second place
   * for it to be wrong. Silent for a workspace with one business, which is
   * almost all of them — a label that is the same on every row is noise.
   */
  const businessList = businesses ?? [];
  const businessLabel = (id: string | null | undefined): string | null => {
    if (businessList.length < 2 || !id) return null;
    const row = businessList.find((b) => b.id === id);
    if (!row) return null;
    const spec = row.spec as { companyName?: unknown } | null;
    if (typeof spec?.companyName === "string" && spec.companyName.trim()) return spec.companyName;
    return row.website_url?.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") ?? null;
  };

  const grouped = strategyOrder
    .map((s) => ({
      id: s.id as string | null,
      name: s.name as string,
      business: businessLabel(s.business_profile_id),
      campaigns: campaigns.filter((c) => c.customer_profile_id === s.id),
    }))
    .filter((group) => group.campaigns.length > 0);

  // Campaigns whose strategy was deleted still have to appear. A campaign that
  // is running and invisible is the worst row on this page.
  const orphaned = campaigns.filter((c) => !strategyOrder.some((s) => s.id === c.customer_profile_id));
  if (orphaned.length) {
    grouped.push({ id: null, name: "No strategy", business: null, campaigns: orphaned });
  }

  // The goal each campaign actually sends, through the same resolver the send
  // path uses: a card reading the columns would offer a Booked tile on a
  // campaign whose pointer now sends a link.
  const goals = await campaignCtas(supabase, session.workspaceId, campaigns);
  const strategyName = new Map(strategyOrder.map((s) => [s.id as string, s.name as string]));
  const cardFor = (campaign: (typeof campaigns)[number]): CampaignCardData => {
    const stats = byCampaign.get(campaign.id) ?? { queued: 0, total: 0, failed: 0, rows: [] };
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      createdAt: campaign.created_at,
      strategy: campaign.customer_profile_id ? (strategyName.get(campaign.customer_profile_id) ?? null) : null,
      goal: goals.get(campaign.id)?.kind ?? campaign.cta_kind,
      people: stats.total,
      waiting: stats.queued,
      counts: countFunnel(stats.rows),
      needs: needsLine(campaign.status, stats, heldBy.get(campaign.id) ?? 0),
    };
  };

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Campaigns"
        lede="Each campaign invites one list of people and follows up for you. They are grouped by the strategy they came from."
        actions={
          <>
            {/* Every chart and table lives on the Results page. */}
            <Link className="btn ghost small" href="/app/analytics">
              Results
            </Link>
            {/* The way to start another one, once there is one already. It
                was only offered on the empty screen, so the second campaign
                had no door. */}
            <Link className="btn small" href="/app/campaigns/new">
              New campaign
            </Link>
          </>
        }
      />
      {/* Refusals and confirmations from the campaign screens redirect here,
          and this branch used to render no banner — so they said nothing. */}
      <PageNotice error={notice.error} notice={notice.notice} />
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
          // The business first, because it is the coarser fact: two strategies
          // with similar names under different companies is exactly the pair a
          // rep needs to tell apart before pressing Launch.
          title={group.business ? `${group.business} · ${group.name}` : group.name}
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
          <div className="campaign-cards">
            {group.campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={cardFor(campaign)}
                timezone={viewer?.timezone ?? null}
                statusAction={setStatus}
              />
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

/**
 * What one campaign needs from the person, in a line, most urgent first.
 *
 * A reply held for them outranks everything: somebody is waiting for an
 * answer. Then work that cannot finish on its own (failed sends, a draft
 * nobody has launched, a running list with nobody left), and only then the
 * quiet line, which says so rather than leaving a blank where the line was.
 */
function needsLine(
  status: string,
  stats: { queued: number; total: number; failed: number },
  held: number,
): CampaignCardData["needs"] {
  if (held > 0) {
    return { tone: "attention", text: `${held} ${held === 1 ? "conversation is" : "conversations are"} waiting for you in the inbox` };
  }
  if (stats.failed > 0) {
    return { tone: "attention", text: `${stats.failed} ${stats.failed === 1 ? "send" : "sends"} failed and can be retried` };
  }
  if (status === "draft") {
    return stats.total > 0
      ? { tone: "attention", text: "Waiting for you to read the list and launch" }
      : { tone: "attention", text: "Nobody on the list yet" };
  }
  if (status === "running" && stats.queued === 0) {
    return { tone: "attention", text: "Nobody left to invite. Find more on its People section" };
  }
  if (status === "paused") return { tone: "quiet", text: "Paused. Nothing goes out until you resume it" };
  return { tone: "quiet", text: "Nothing needs you" };
}
