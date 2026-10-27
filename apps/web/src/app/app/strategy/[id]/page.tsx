import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BusinessProfileSchema,
  CTA_DEFINITIONS,
  CTA_KINDS,
  MAX_STRATEGY_PRIORITY,
  competitorTargeting,
  describeCompetitorTargeting,
  parseCustomerProfile,
} from "@le/shared";
import { PageNotice } from "@/components/page-notice";
import { Empty, PageHeader, Section } from "@/components/page";
import { SectionLayout } from "@/components/section-nav";
import { StrategyNav } from "@/components/strategy-nav";
import { StrategyFacts } from "@/components/strategy-facts";
import { StrategySearchNotices } from "@/components/strategy-notices";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { HOW_MANY } from "@/lib/search";
import { SEARCH_EVENTS, describeLastSearch } from "@/lib/last-search";
import { FILTER_FIELDS, formatList } from "@/lib/profile-form";
import { formatDate, isoAttr } from "@/lib/format";
import { label } from "@/lib/labels";
import { approveProfile, dropProfile, findProspects, saveProfile } from "../actions";
import { businessLabel, loadStrategyMenu, strategyName, strategyState } from "../data";

const UUID = /^[0-9a-f-]{36}$/i;

/** What the targeting job recorded about how a campaign's list was searched (rule 12). */
function ruleStrings(rules: unknown, key: "droppedFilters" | "filterNotes"): string[] {
  if (!rules || typeof rules !== "object") return [];
  const value = (rules as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * One strategy, on its own page: who they are, why they would pay, what hurts,
 * the openers, the search and the campaigns it built — and the one decision
 * this screen exists for, approving it (rule 9), beside the competitor check
 * that decision has to be made next to (rule 49).
 */
export default async function StrategyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!UUID.test(id)) notFound();
  const session = await requireSession();
  const supabase = await createClient();

  const [menu, { data: campaignRows }, { data: lastStop }, { data: account }, { data: me }] = await Promise.all([
    loadStrategyMenu(supabase, session.workspaceId),
    supabase
      .from("campaigns")
      .select("id, name, status, rules, search_exhausted, searched_at, launched_at, created_at")
      .eq("workspace_id", session.workspaceId)
      .eq("customer_profile_id", id)
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

  // Read through the workspace's own list: an id in a URL is a claim, and one
  // naming another workspace's strategy is simply not found.
  const row = menu.profiles.find((profile) => profile.id === id);
  if (!row) notFound();

  const timezone = me?.timezone ?? null;
  const connected = account?.status === "active";
  const lastSearch = describeLastSearch(lastStop);
  const businessRow = menu.businesses.find((b) => b.id === row.business_profile_id) ?? menu.businesses[0] ?? null;
  const business = businessRow ? BusinessProfileSchema.safeParse(businessRow.spec) : null;
  const siblings = menu.profiles.filter((p) => p.business_profile_id === row.business_profile_id);
  const businessHref =
    menu.businesses.length > 1 && businessRow ? `/app/strategy?business=${businessRow.id}` : "/app/strategy";
  const stats = menu.yieldByStrategy.get(row.id);
  const state = strategyState(row);
  const approved = state === "approved";
  const spec = parseCustomerProfile(row.spec);
  const campaigns = campaignRows ?? [];

  /*
   * Is this segment made of the company's own competitors?
   *
   * Asked here because this is where approval happens (rule 9), and because
   * the agent contradicted itself on exactly this point and nobody was told:
   * it listed BNI as a competitor and made BNI chapter presidents the
   * priority-1 segment, which was then approved. A question rather than a
   * refusal — selling to the groups you compete with is a real go-to-market,
   * and the cost of asking is one sentence read.
   */
  const rivals =
    spec.success && business?.success
      ? describeCompetitorTargeting(competitorTargeting(spec.data, business.data))
      : null;

  // What LinkedIn actually matched, across every list this strategy built.
  const filterNotes = [...new Set(campaigns.flatMap((c) => ruleStrings(c.rules, "filterNotes")))];
  const dropped = [...new Set(campaigns.flatMap((c) => ruleStrings(c.rules, "droppedFilters")))];

  const statePill = (
    <span className={`pill ${approved ? "positive" : state === "waiting" ? "warning" : "plain"}`}>
      {approved ? "Approved" : state === "waiting" ? "Waiting for your approval" : "Set aside"}
    </span>
  );

  const actions = (
    // Set-aside strategies keep their buttons at full strength: dimmed, "Pursue
    // after all" looked disabled, and it is the one thing here that still works.
    <div className="cluster">
      {row.do_not_pursue ? (
        <form action={approveProfile}>
          <input type="hidden" name="profileId" value={row.id} />
          <input type="hidden" name="strategyPage" value={row.id} />
          <SubmitButton className="btn secondary small" pendingLabel="Approving…">
            Pursue after all
          </SubmitButton>
        </form>
      ) : approved ? (
        <form action={findProspects}>
          <input type="hidden" name="profileId" value={row.id} />
          <input type="hidden" name="strategyPage" value={row.id} />
          <SubmitButton
            className="btn small"
            disabled={!connected}
            pendingLabel="Searching LinkedIn…"
            title={connected ? undefined : "Connect your LinkedIn account first"}
          >
            Find {HOW_MANY} prospects
          </SubmitButton>
        </form>
      ) : !row.name?.trim() || !spec.success ? (
        // Written from nothing, or no longer readable: there is no segment to
        // approve, and `approveStrategy` refuses a nameless one as well.
        <p className="small muted">Nothing here to approve. Set it aside and ask Sage for more.</p>
      ) : (
        <form action={approveProfile}>
          <input type="hidden" name="profileId" value={row.id} />
          <input type="hidden" name="strategyPage" value={row.id} />
          <SubmitButton className="btn small" pendingLabel="Approving…">
            Approve
          </SubmitButton>
        </form>
      )}
      {row.do_not_pursue ? null : (
        <form action={dropProfile}>
          <input type="hidden" name="profileId" value={row.id} />
          <input type="hidden" name="strategyPage" value={row.id} />
          <SubmitButton className="btn secondary small" pendingLabel="Setting aside…">
            Not this market
          </SubmitButton>
        </form>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ href: businessHref, label: "Strategies" }]}
        title={strategyName(row)}
        status={statePill}
        lede={spec.success ? spec.data.summary : undefined}
        actions={actions}
      />
      <PageNotice error={query.error} notice={query.notice} />
      <StrategySearchNotices lastSearch={lastSearch} timezone={timezone} connected={connected} />

      <SectionLayout
        nav={
          <StrategyNav
            businessHref={businessHref}
            businessName={businessRow ? businessLabel(businessRow) : "Your business"}
            strategies={siblings.map((s) => ({
              ...s,
              found: menu.yieldByStrategy.get(s.id)?.found ?? 0,
              campaigns: menu.yieldByStrategy.get(s.id)?.campaigns ?? 0,
            }))}
          />
        }
      >
        {rivals ? (
          <div className="notice warning">
            <p>
              <strong>Check this is who you meant.</strong> {rivals}
            </p>
          </div>
        ) : null}

        {!spec.success ? (
          <div className="notice danger">
            <p>
              “{strategyName(row)}” no longer matches the current schema, so it cannot be edited or
              searched for. Set it aside and ask Sage for more, or tell us through Support.
            </p>
          </div>
        ) : (
          <>
            <Section id="who" title="Who they are">
              {/* Every field can be empty (a strategy Sage barely filled in),
                  and an empty card read as a page that failed to load. */}
              {[
                spec.data.jobTitles,
                spec.data.seniority,
                spec.data.industries,
                [spec.data.companySize],
                spec.data.geography,
                spec.data.triggerEvents,
              ].every((list) => !(list ?? []).some((v) => typeof v === "string" && v.trim())) ? (
                <p className="small muted">
                  Sage did not say who they are in detail. Add job titles, industries and places under
                  Search filters below before approving.
                </p>
              ) : (
              <div className="card">
                <div className="grid grid-3">
                  <StrategyFacts label="Job titles" values={spec.data.jobTitles} />
                  <StrategyFacts label="Seniority" values={spec.data.seniority} />
                  <StrategyFacts label="Industries" values={spec.data.industries} />
                  <StrategyFacts label="Company size" values={[spec.data.companySize]} />
                  <StrategyFacts label="Where" values={spec.data.geography} />
                  <StrategyFacts label="Buying signals" values={spec.data.triggerEvents} />
                </div>
              </div>
              )}
            </Section>

            {/*
              Why this segment would pay, stated rather than assumed.

              Everything else here reads the same whether the segment buys what
              you sell or sells it themselves — a title is a title. These two are
              the ones a competitor cannot answer, so they are the two worth
              reading before approving. Named as unsaid when the strategy
              predates them, never left blank: a missing fact presented as no
              fact reads as agreement.
            */}
            <Section
              id="buy"
              title="What they buy, and what they do today"
              description="The two questions a competitor cannot answer honestly. Read these before approving."
            >
              <div className="card">
                <div className="grid grid-3">
                  <StrategyFacts label="What they buy" values={[spec.data.whatTheyBuy]} unsaid="The agent did not say." />
                  <StrategyFacts
                    label="What they do today instead"
                    values={[spec.data.insteadOfToday]}
                    unsaid="The agent did not say."
                  />
                  <StrategyFacts label="What we say" values={[spec.data.valueProposition]} />
                </div>
              </div>
            </Section>

            <Section id="pains" title="Pains">
              <div className="card">
                <StrategyFacts label="What hurts" values={spec.data.pains} unsaid="The agent named no pains for this strategy." />
              </div>
            </Section>

            <Section
              id="openers"
              title="Openers"
              description="Shapes the invite writer leans on, never text it pastes."
              action={
                <Link className="btn ghost small" href="/app/pitch">
                  Opener and pitch
                </Link>
              }
            >
              <div className="card">
                <StrategyFacts label="Opening angles" values={spec.data.hooks} unsaid="No openers were written for this strategy." />
              </div>
            </Section>

            <Section
              id="search"
              title="Search filters"
              description="One per line. These go straight into the LinkedIn search, so a title here is a title LinkedIn has to recognize."
            >
              {filterNotes.length || dropped.length ? (
                <div className="notice">
                  <strong>What LinkedIn matched</strong>
                  <p className="small">
                    LinkedIn searches places and industries by its own identifiers, not by name, so each
                    term was looked up first. A term left out is a filter these lists do not have.
                  </p>
                  {dropped.length ? (
                    <p className="small">Not filtered on at all: {dropped.join(", ")}.</p>
                  ) : null}
                  {filterNotes.length ? (
                    <ul className="bullets small">
                      {filterNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="small muted">
                  {campaigns.length
                    ? "Every term in this search was matched as written."
                    : "Not searched yet. What LinkedIn matches for each term is shown here after the first search."}
                </p>
              )}
              <form action={saveProfile} className="card">
                <input type="hidden" name="profileId" value={row.id} />
                <input type="hidden" name="strategyPage" value={row.id} />
                <div className="grid tight grid-3">
                  {FILTER_FIELDS.map((field) => (
                    <label className="field" key={field.key}>
                      <span>{field.label}</span>
                      <textarea
                        name={field.key}
                        rows={3}
                        defaultValue={formatList(spec.data.salesNavFilters[field.key])}
                      />
                    </label>
                  ))}
                  <label className="field">
                    <span>Priority · 1 goes first</span>
                    <input
                      type="number"
                      name="priority"
                      min={1}
                      max={MAX_STRATEGY_PRIORITY}
                      defaultValue={row.priority}
                    />
                  </label>
                  {/*
                    The ask, set here rather than on the campaign. Every message
                    in a sequence is written toward it, so choosing it afterwards
                    leaves copy that was arguing for something else. Not
                    everybody wants a meeting.
                  */}
                  <label className="field">
                    <span>What campaigns from this strategy ask for</span>
                    <select name="ctaKind" defaultValue={row.cta_kind}>
                      {CTA_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {CTA_DEFINITIONS[kind].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Name the ask · optional</span>
                    <input
                      type="text"
                      name="ctaLabel"
                      maxLength={60}
                      autoComplete="off"
                      placeholder="Try it free, See the comparison…"
                      defaultValue={row.cta_label ?? ""}
                    />
                  </label>
                  <label className="field">
                    <span>Where it sends them · only for a link</span>
                    <input
                      type="url"
                      name="ctaUrl"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="https://…"
                      defaultValue={row.cta_url ?? ""}
                    />
                    <span className="tiny subtle">
                      Never appears in the connection request: LinkedIn penalizes links there and they cut
                      acceptance. It goes in the last message.
                    </span>
                  </label>
                </div>
                <div>
                  <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                    Save search
                  </SubmitButton>
                </div>
              </form>
            </Section>
          </>
        )}

        {/*
          What this strategy has produced, not just where it ranks. A strategy
          that found four hundred people and contacted none is a different
          problem from one that found nobody, and a priority number tells you
          neither.
        */}
        <Section
          id="campaigns"
          title="Campaigns from it"
          description={
            stats?.found
              ? `${stats.found.toLocaleString()} ${stats.found === 1 ? "person" : "people"} found, ${stats.contacted.toLocaleString()} contacted.`
              : approved
                ? "Nobody found yet. The search runs once it is approved, and people appear under Prospects as it finds them."
                : "Nothing is searched for until this strategy is approved."
          }
          action={
            stats?.found ? (
              <Link className="btn ghost small" href={`/app/prospects?strategy=${row.id}`}>
                See the people
              </Link>
            ) : undefined
          }
        >
          {campaigns.length === 0 ? (
            <Empty title="No campaign has come from this strategy yet.">
              {approved
                ? `Find ${HOW_MANY} prospects above builds one for you to review. Nobody is contacted until you launch it.`
                : "Approving it starts the search, and the search builds a campaign for you to review."}
            </Empty>
          ) : (
            <div className="table-scroll card-rows">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Search</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => {
                    const when = campaign.launched_at ?? campaign.created_at;
                    return (
                      <tr key={campaign.id}>
                        <td data-label="Campaign">
                          <Link className="strongish" href={`/app/campaigns/${campaign.id}`}>
                            {campaign.name}
                          </Link>
                        </td>
                        <td data-label="Status">
                          <span className={`pill ${campaign.status === "running" ? "positive" : "plain"}`}>
                            {label(campaign.status)}
                          </span>
                        </td>
                        <td data-label="Search" className="muted">
                          {campaign.search_exhausted ? "Reached the end of LinkedIn's answer" : "Find more available"}
                        </td>
                        <td data-label="Started" className="muted">
                          <time dateTime={isoAttr(when)}>{formatDate(when, timezone)}</time>
                          {campaign.launched_at ? null : <span className="tiny subtle block">Not launched</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </SectionLayout>
    </>
  );
}
