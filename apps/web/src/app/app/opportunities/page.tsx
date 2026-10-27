import Link from "next/link";
import { Empty, PageHeader, Section } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { OpportunityCard, type OpportunityCardData } from "@/components/opportunity-card";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { CAMPAIGN_CTA_COLUMNS, campaignCtas } from "@/lib/campaign-cta";
import { OPPORTUNITY_STAGES, opportunityStageOf, type OpportunityStage } from "./stage";

/** How many answered conversations the board reads. Said on screen when reached. */
const BOARD_LIMIT = 500;

interface BoardRow {
  id: string;
  prospect_id: string;
  campaign_id: string;
  status: string;
  invited_at: string | null;
  accepted_at: string | null;
  replied_at: string | null;
  last_step_sent: number | null;
}

/**
 * Everybody who answered, by where the conversation is going.
 *
 * The inbox is the place to act — reply, approve, book — and its stage tabs
 * are a history of everyone written to. Neither shows the shape of the
 * pipeline: how many answers are yeses, how many are "not yet", which campaign
 * they came from. This is that, read from the same rows the inbox reads
 * (`campaign_prospects`, `conversations`, the latest reply's recorded intent)
 * through the inbox's own stage reading (`opportunityStageOf` builds on
 * `inboxStageOf`), and every card opens the conversation in the inbox.
 *
 * Read-only. A card moves when the conversation does: a person replying,
 * the agent recording interest, a meeting being booked. Dragging one here
 * would change a label without changing anything the agent acts on, which is
 * a board that says one thing while the product does another.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; campaign?: string; strategy?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: campaigns }, { data: strategies }, { data: rows }, { data: me }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(`id, name, status, customer_profile_id, ${CAMPAIGN_CTA_COLUMNS}`)
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("customer_profiles")
      .select("id, name")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    // Everybody who has answered, plus any row whose status says so: a
    // meeting booked by hand is on the board whether or not a reply was
    // timestamped first.
    supabase
      .from("campaign_prospects")
      .select("id, prospect_id, campaign_id, status, invited_at, accepted_at, replied_at, last_step_sent")
      .eq("workspace_id", session.workspaceId)
      .or("replied_at.not.is.null,status.in.(replied,positive,negative,meeting_booked)")
      .order("replied_at", { ascending: false, nullsFirst: false })
      .limit(BOARD_LIMIT),
    // Times in the rep's own timezone, not the server's.
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);
  const timezone = me?.timezone ?? null;
  const campaignList = campaigns ?? [];
  const strategyList = strategies ?? [];
  const campaignById = new Map(campaignList.map((c) => [c.id, c]));

  // Filters are claims in a URL, so each is checked against this workspace's
  // own lists before it narrows anything.
  const campaignFilter = campaignList.find((c) => c.id === params.campaign) ?? null;
  const strategyFilter = strategyList.find((s) => s.id === params.strategy) ?? null;

  const boardRows = ((rows ?? []) as BoardRow[]).filter((row) => {
    if (campaignFilter && row.campaign_id !== campaignFilter.id) return false;
    if (strategyFilter && campaignById.get(row.campaign_id)?.customer_profile_id !== strategyFilter.id) return false;
    return true;
  });
  const cut = (rows ?? []).length >= BOARD_LIMIT;

  const prospectIds = [...new Set(boardRows.map((row) => row.prospect_id))];
  const [{ data: prospects }, { data: conversations }] = await Promise.all([
    prospectIds.length
      ? supabase
          .from("prospects")
          .select("id, first_name, last_name, headline, title, company")
          .eq("workspace_id", session.workspaceId)
          .in("id", prospectIds)
      : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null; headline: string | null; title: string | null; company: string | null }> }),
    prospectIds.length
      ? supabase
          .from("conversations")
          .select("id, prospect_id, campaign_id, last_message_at, needs_human")
          .eq("workspace_id", session.workspaceId)
          .in("prospect_id", prospectIds)
      : Promise.resolve({ data: [] as Array<{ id: string; prospect_id: string; campaign_id: string | null; last_message_at: string | null; needs_human: boolean }> }),
  ]);
  const conversationIds = (conversations ?? []).map((c) => c.id);
  // Their latest words, which is what the reply agent reads intent from.
  const { data: inbound } = conversationIds.length
    ? await supabase
        .from("messages")
        .select("conversation_id, body, classification, created_at")
        .eq("workspace_id", session.workspaceId)
        .eq("direction", "inbound")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(2000)
    : { data: [] as Array<{ conversation_id: string; body: string; classification: unknown; created_at: string }> };

  const latestByConversation = new Map<string, { body: string; classification: unknown; created_at: string }>();
  for (const message of inbound ?? []) {
    // Newest first, so the first seen is the latest.
    if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
  }
  const prospectById = new Map((prospects ?? []).map((p) => [p.id, p]));
  // A conversation belongs to a prospect on one account; matched to the
  // campaign row by campaign where it can be, by person where it cannot.
  const conversationFor = (row: BoardRow) => {
    const theirs = (conversations ?? []).filter((c) => c.prospect_id === row.prospect_id);
    return theirs.find((c) => c.campaign_id === row.campaign_id) ?? theirs[0] ?? null;
  };

  // Whether any campaign here can reach a meeting. A column that can only ever
  // read zero reports a link campaign as failing at something it never asked
  // for (rule 29), so it shows only when a campaign asks for meetings or
  // somebody has booked one anyway — the inbox's own rule.
  const ctaByCampaign = await campaignCtas(supabase, session.workspaceId, campaignList);
  const asksForMeetings = [...ctaByCampaign.values()].some((cta) => cta.kind === "meeting");

  const cards = new Map<OpportunityStage, OpportunityCardData[]>(OPPORTUNITY_STAGES.map((s) => [s.key, []]));
  for (const row of boardRows) {
    const conversation = conversationFor(row);
    const latest = conversation ? latestByConversation.get(conversation.id) : undefined;
    const stage = opportunityStageOf(row, latest);
    if (!stage) continue;
    const prospect = prospectById.get(row.prospect_id);
    const campaign = campaignById.get(row.campaign_id);
    cards.get(stage)!.push({
      id: row.id,
      name: `${prospect?.first_name ?? ""} ${prospect?.last_name ?? ""}`.trim() || prospect?.headline?.trim() || "LinkedIn member",
      company: prospect?.company ?? null,
      title: prospect?.title ?? null,
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
      lastMessageAt: conversation?.last_message_at ?? latest?.created_at ?? row.replied_at,
      waitingOnYou: Boolean(conversation?.needs_human),
      // The inbox has no page per conversation: a held one is under "Waiting
      // on you", where it can be answered, and the rest under their stage.
      inboxHref: conversation?.needs_human
        ? "/app/inbox"
        : stage === "booked"
          ? "/app/inbox?stage=booked"
          : "/app/inbox?stage=replied",
    });
  }
  for (const list of cards.values()) {
    list.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  }

  const open = OPPORTUNITY_STAGES.filter(
    (s) => !s.collapsed && (s.key !== "booked" || asksForMeetings || (cards.get("booked")?.length ?? 0) > 0),
  );
  const collapsed = OPPORTUNITY_STAGES.filter((s) => s.collapsed);
  const total = [...cards.values()].reduce((sum, list) => sum + list.length, 0);
  const filtered = Boolean(campaignFilter || strategyFilter);

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Opportunities"
        lede="Everybody who has answered, grouped by how the conversation is going. Cards move on their own as people reply, say yes or book. Open one to answer it."
      />
      <PageNotice error={params.error} notice={params.notice} />

      {/* A plain GET form, so a filtered board is an address that can be
          bookmarked and works without JavaScript. With it, picking an option
          applies it; the Show button is only there for a browser without. */}
      <AutoSubmitForm method="get" action="/app/opportunities" className="opp-filters" aria-label="Filter the board">
        <label className="field opp-filter-field">
          <span>Campaign</span>
          <select name="campaign" defaultValue={campaignFilter?.id ?? ""}>
            <option value="">All campaigns</option>
            {campaignList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field opp-filter-field">
          <span>Strategy</span>
          <select name="strategy" defaultValue={strategyFilter?.id ?? ""}>
            <option value="">All strategies</option>
            {strategyList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <div className="opp-filter-actions">
            <Link className="btn ghost" href="/app/opportunities">
              Show everybody
            </Link>
          </div>
        ) : null}
        <noscript>
          <button type="submit" className="btn secondary">
            Show
          </button>
        </noscript>
      </AutoSubmitForm>

      {cut ? (
        <p className="small muted">
          Showing the {BOARD_LIMIT} most recent answers; older conversations are in the inbox&rsquo;s Replied tab.
        </p>
      ) : null}

      {total === 0 ? (
        <Empty
          title={filtered ? "Nobody from this campaign or strategy has answered yet." : "Nobody has answered yet."}
          action={filtered ? undefined : "See who you have written to"}
          href={filtered ? undefined : "/app/inbox?stage=messaged"}
        >
          {filtered
            ? "Choose All campaigns and All strategies to see the whole board."
            : "A card appears here the moment somebody replies, and moves as the conversation does. Everybody you have written to is in the inbox."}
        </Empty>
      ) : (
        <>
          <Section
            id="open"
            title="Open conversations"
            description={`${open.reduce((sum, s) => sum + (cards.get(s.key)?.length ?? 0), 0)} conversations going somewhere.`}
          >
            <div className="opp-board" data-columns={open.length}>
              {open.map((stage) => {
                const list = cards.get(stage.key) ?? [];
                return (
                  <section key={stage.key} className="opp-column" aria-labelledby={`opp-${stage.key}`}>
                    <h3 id={`opp-${stage.key}`} className="opp-column-head">
                      <span className="opp-dot" data-stage={stage.key} aria-hidden="true" />
                      {stage.label}
                      <span className="opp-count">{list.length}</span>
                    </h3>
                    {list.length === 0 ? (
                      <p className="opp-none small subtle">Nobody here yet.</p>
                    ) : (
                      <ul className="opp-cards">
                        {list.map((card) => (
                          <li key={card.id}>
                            <OpportunityCard card={card} timezone={timezone} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </Section>

          {/*
            Not now and Closed are folded away: they are answers, not work.
            Kept on the board rather than dropped, because "how many said not
            yet" is a number somebody running a campaign asks for, and a
            not-yet is the one to write to again next quarter.
          */}
          <Section id="later" title="Not now and closed">
            <div className="opp-folded">
              {collapsed.map((stage) => {
                const list = cards.get(stage.key) ?? [];
                return (
                  <details key={stage.key} className="opp-fold">
                    <summary>
                      <span className="opp-dot" data-stage={stage.key} aria-hidden="true" />
                      {stage.label}
                      <span className="opp-count">{list.length}</span>
                    </summary>
                    {list.length === 0 ? (
                      <p className="opp-none small subtle">Nobody here.</p>
                    ) : (
                      <ul className="opp-cards opp-cards-grid">
                        {list.map((card) => (
                          <li key={card.id}>
                            <OpportunityCard card={card} timezone={timezone} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                );
              })}
            </div>
          </Section>
        </>
      )}
    </>
  );
}
