import Link from "next/link";
import { Empty, PageHeader, Section } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { SectionLayout } from "@/components/section-nav";
import { ProspectNav } from "@/components/prospect-nav";
import { StrategySearchNotices } from "@/components/strategy-notices";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { HOW_MANY } from "@/lib/search";
import { SEARCH_EVENTS, describeLastSearch } from "@/lib/last-search";
import { formatDate, isoAttr } from "@/lib/format";
import { label } from "@/lib/labels";
import { findProspects } from "../../strategy/actions";
import { loadStrategyMenu, strategyName } from "../../strategy/data";
import { loadProspectMenu } from "../data";

/**
 * Finding more people, through the two searches this product already has and
 * no third.
 *
 * A strategy with a campaign grows that campaign: Find more on its page reads
 * the next page of the same search from where it stopped (rule 20), and the
 * campaign keeps the copy a person already approved. A strategy with no
 * campaign yet starts its first search through `findProspects` — the same
 * action, and the same `queueSearch`, that approving and the strategy page
 * use. A search that has reached the end of LinkedIn's answer offers no button
 * at all, because pressing it again would only report zero: the way on from
 * there is a wider search or a new strategy, and both are linked.
 */
export default async function FindProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [menu, strategies, { data: campaignRows }, { data: lastStop }, { data: account }, { data: me }] =
    await Promise.all([
      loadProspectMenu(supabase, session.workspaceId),
      loadStrategyMenu(supabase, session.workspaceId),
      supabase
        .from("campaigns")
        .select("id, name, status, customer_profile_id, search_exhausted, searched_at, created_at")
        .eq("workspace_id", session.workspaceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("events")
        .select("name, payload, created_at")
        .eq("workspace_id", session.workspaceId)
        .in("name", SEARCH_EVENTS)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("linkedin_accounts")
        .select("status")
        .eq("workspace_id", session.workspaceId)
        .eq("user_id", session.userId)
        .maybeSingle(),
      supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    ]);
  const timezone = me?.timezone ?? null;
  const connected = account?.status === "active";
  const lastSearch = describeLastSearch(lastStop);

  const approved = strategies.profiles.filter((p) => p.approved_at && !p.do_not_pursue);
  const waiting = strategies.profiles.filter((p) => !p.approved_at && !p.do_not_pursue && p.name?.trim());
  const campaignsFor = (id: string) => (campaignRows ?? []).filter((c) => c.customer_profile_id === id);

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Prospects"
        lede="Find more people for the strategies you have approved. Everyone already on your list is skipped, so nobody is contacted twice, and every new name waits for your review before anything is sent."
      />
      <PageNotice error={params.error} notice={params.notice} />
      <StrategySearchNotices lastSearch={lastSearch} timezone={timezone} connected={connected} />
      <SectionLayout
        nav={<ProspectNav everyone={menu.everyone} review={menu.review} searchable={menu.searchable} excluded={menu.excluded} />}
      >
        <Section
          id="approved"
          title="Search an approved strategy"
          description={`Each search reads ${HOW_MANY} more profiles from LinkedIn, scores them against the strategy, and adds whoever is new to a campaign for you to review.`}
        >
          {approved.length === 0 ? (
            <Empty title="No strategy is approved yet." action="Read your strategies" href="/app/strategy">
              Nothing is searched for until you approve one. Approving starts its first search.
            </Empty>
          ) : (
            <ul className="prospect-find-list">
              {approved.map((strategy) => {
                const stats = strategies.yieldByStrategy.get(strategy.id);
                const campaigns = campaignsFor(strategy.id);
                // The list to grow: the newest campaign still in use whose
                // search has somewhere left to go.
                const growable = campaigns.find(
                  (c) => c.status !== "archived" && c.status !== "completed" && !c.search_exhausted,
                );
                const exhausted = campaigns.length > 0 && campaigns.every((c) => c.search_exhausted);
                return (
                  <li key={strategy.id} className="card prospect-find-item">
                    <div className="prospect-find-text">
                      <Link className="strongish" href={`/app/strategy/${strategy.id}`}>
                        {strategyName(strategy)}
                      </Link>
                      <p className="small muted">
                        Priority {strategy.priority} · {(stats?.found ?? 0).toLocaleString()} found ·{" "}
                        {(stats?.contacted ?? 0).toLocaleString()} contacted
                      </p>
                      {growable ? (
                        <p className="tiny subtle">
                          Grows <Link href={`/app/campaigns/${growable.id}`}>{growable.name}</Link> (
                          {label(growable.status).toLowerCase()})
                          {growable.searched_at ? (
                            <>
                              , last read{" "}
                              <time dateTime={isoAttr(growable.searched_at)}>
                                {formatDate(growable.searched_at, timezone)}
                              </time>
                            </>
                          ) : null}
                          . It keeps the copy you approved.
                        </p>
                      ) : exhausted ? (
                        <p className="tiny subtle">
                          LinkedIn has no more people matching this search. Widen its filters, or ask Sage
                          for a strategy that reaches somebody new.
                        </p>
                      ) : (
                        <p className="tiny subtle">No campaign yet. The search builds one for you to review.</p>
                      )}
                    </div>
                    <div className="prospect-find-action">
                      {growable ? (
                        // Find more lives on the campaign, where the position
                        // the search stopped at is kept (rule 20).
                        <Link className="btn small" href={`/app/campaigns/${growable.id}`}>
                          Find more on this campaign
                        </Link>
                      ) : exhausted ? (
                        <Link className="btn secondary small" href={`/app/strategy/${strategy.id}#search-heading`}>
                          Widen the search
                        </Link>
                      ) : (
                        <form action={findProspects}>
                          <input type="hidden" name="profileId" value={strategy.id} />
                          <input type="hidden" name="from" value="prospects-find" />
                          <SubmitButton
                            className="btn small"
                            disabled={!connected}
                            pendingLabel="Searching LinkedIn…"
                            title={connected ? undefined : "Connect your LinkedIn account first"}
                          >
                            Find {HOW_MANY} prospects
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/*
          Targeting more of the right community is a strategy question before
          it is a search question: a search can only find more of who a
          strategy describes.
        */}
        <Section
          id="more"
          title="Reach somebody new"
          description="A search finds more of the people a strategy describes. To reach a different group, approve another strategy or ask Sage for more."
        >
          <div className="card">
            {waiting.length ? (
              <>
                <p className="small">
                  {waiting.length} {waiting.length === 1 ? "strategy is" : "strategies are"} waiting for your
                  approval:
                </p>
                <ul className="bullets small">
                  {waiting.map((s) => (
                    <li key={s.id}>
                      <Link href={`/app/strategy/${s.id}`}>{strategyName(s)}</Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="small muted">Every strategy Sage has written has been approved or set aside.</p>
            )}
            <div className="cluster">
              <Link className="btn secondary small" href="/app/strategy/more">
                Ask Sage for more strategies
              </Link>
            </div>
          </div>
        </Section>
      </SectionLayout>
    </>
  );
}
