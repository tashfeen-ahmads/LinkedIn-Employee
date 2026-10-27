import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Empty, PageHeader } from "@/components/page";
import { SectionLayout } from "@/components/section-nav";
import { ProspectNav } from "@/components/prospect-nav";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { isPublicProfileUrl, profileHref } from "@le/shared";
import { redirect } from "next/navigation";
import { PageNotice } from "@/components/page-notice";
import { ConfirmButton } from "@/components/confirm-button";
import { formatDate, formatDateTime, isoAttr } from "@/lib/format";
import { fetchAllRows } from "@/lib/rows";
import { label } from "@/lib/labels";
import { inboxStageOf, type InboxStage } from "@/lib/inbox-stage";
import { displayName, loadProspectMenu, shortName } from "./data";

/** How many rows the list reads at once. Said on screen when there are more. */
const PAGE_LIMIT = 200;

/**
 * The list's own address, with whatever it is filtered by.
 *
 * Every link and every redirect on this page goes through here, so erasing
 * somebody from a filtered list lands back on that list rather than on
 * everybody — and a filter tab keeps the search that was typed.
 */
function listHref(filters: { strategy?: string | null; show?: string | null; q?: string | null }): string {
  const query = new URLSearchParams();
  if (filters.strategy) query.set("strategy", filters.strategy);
  if (filters.show && filters.show !== "all") query.set("show", filters.show);
  if (filters.q) query.set("q", filters.q);
  const text = query.toString();
  return text ? `/app/prospects?${text}` : "/app/prospects";
}

/** Appends a banner message to an address that may already carry a query. */
function withMessage(href: string, key: "notice" | "error", message: string): string {
  const base = key === "notice" ? noticeQuery("", message) : errorQuery("", message);
  return href.includes("?") ? `${href}&${base.slice(1)}` : `${href}${base}`;
}

/**
 * A search term as a PostgREST `or` filter value, matched anywhere in the text.
 *
 * Two levels of escaping, because there are two parsers. `%` and `_` are
 * wildcards to `ilike`, so "50%" would match everything starting with 50 — they
 * are escaped for LIKE. The value is then double-quoted so a comma or a bracket
 * in somebody's company name is read as text rather than as the next filter,
 * and inside those quotes PostgREST treats `"` and `\` as escapes of their own.
 * `*` is PostgREST's URL-friendly alias for `%`, so it is dropped.
 */
function containsPattern(term: string): string {
  const like = term.replaceAll("*", "").replace(/[\\%_]/g, (c) => `\\${c}`);
  return `"%${like.replace(/["\\]/g, (c) => `\\${c}`)}%"`;
}

/**
 * Erasure on request. A prospect who asks to be forgotten is a request the
 * customer is legally obliged to honour, so it is one click rather than a
 * support ticket.
 */
async function eraseProspect(formData: FormData) {
  "use server";
  const prospectId = String(formData.get("prospectId") ?? "");
  if (!prospectId) return;
  // Back to the list as it was filtered, never to an address the form names
  // freely: only this page's own path is accepted.
  const backRaw = String(formData.get("back") ?? "");
  const back = backRaw.startsWith("/app/prospects") ? backRaw : "/app/prospects";
  const who = String(formData.get("prospectName") ?? "").trim().slice(0, 120) || "this person";

  const session = await requireSession();
  // Erasure is a promise made to a person about their own data. A silent
  // failure here leaves them in the database while the screen says they are
  // gone, so this one is reported rather than retried in the background.
  const erased = await callWorker("/jobs/erase-prospect", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    prospectId,
    reason: "requested by the individual",
  });
  if (!erased.ok) {
    console.error(`[prospects] erase failed: ${erased.error}`);
    redirect(
      withMessage(
        back,
        "error",
        `${who} was not erased, and nothing was deleted. Try again, and tell us through Support if it keeps happening.`,
      ),
    );
  }
  revalidatePath("/app/prospects", "layout");
  redirect(withMessage(back, "notice", `Erased ${who}. Only a do-not-contact record remains.`));
}

interface Signal {
  type: string;
  detail: string;
  observedAt: string;
  weight: number;
}

const SIGNAL_LABELS: Record<string, string> = {
  new_role: "New role",
  company_hiring: "Hiring",
  recent_funding: "Funding",
  posted_recently: "Posted recently",
  engaged_with_content: "Engaged",
  viewed_profile: "Viewed you",
  follows_company: "Follows you",
  open_to_work: "Open to work",
  other: "Signal",
};

/** The inbox's own stage names, so a person reads the same word on both screens. */
const STAGE_LABELS: Record<InboxStage, string> = {
  invited: "Invited",
  accepted: "Accepted",
  messaged: "Messaged",
  replied: "Replied",
  booked: "Meeting booked",
};
const STAGE_RANK: Record<InboxStage, number> = { invited: 1, accepted: 2, messaged: 3, replied: 4, booked: 5 };
const ENDED = new Set(["closed", "failed", "opted_out", "negative"]);

interface CampaignRow {
  prospect_id: string;
  campaign_id: string;
  status: string;
  invited_at: string | null;
  accepted_at: string | null;
  replied_at: string | null;
  last_step_sent: number | null;
}

/** Everyone this workspace has found, with where each of them got to. */
export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; show?: string; strategy?: string; q?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // Contacted people first, and by when. "There is no backup of the data — who
  // I have reached out to, who I know" was the report, and it was accurate: the
  // list was ranked by fit score, so somebody messaged last week sat wherever
  // their score put them, indistinguishable at a glance from somebody nobody
  // has ever written to (rule 24).
  const showing = params.show === "contacted" ? "contacted" : params.show === "new" ? "new" : "all";

  // Which strategy found them (rule 26). Read from the customer profiles rather
  // than trusted from the query string: an id in a URL is a claim, and this one
  // would otherwise be a way to name another workspace's strategy and see
  // whether it exists.
  const [{ data: strategies }, { data: me }, menu] = await Promise.all([
    supabase
      .from("customer_profiles")
      .select("id, name")
      .eq("workspace_id", session.workspaceId)
      .order("priority", { ascending: true }),
    // Dates on this page are the rep's own days, not the server's.
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    loadProspectMenu(supabase, session.workspaceId),
  ]);
  const timezone = me?.timezone ?? null;

  // The search box in the top bar lands here with `?q=`, which nothing used to
  // read: somebody typed a name, pressed Enter, and got the whole list back.
  const search = (params.q ?? "").trim().slice(0, 100);
  const words = search.split(/\s+/).filter(Boolean).slice(0, 4);

  const strategyList = strategies ?? [];
  const strategy = strategyList.find((s) => s.id === params.strategy) ?? null;

  let query = supabase
    .from("prospects")
    .select(
      "id, provider_id, first_name, last_name, headline, title, company, location, linkedin_url, fit_score, fit_reasons, intent_score, signals, do_not_contact, last_contacted_at, customer_profile_id",
      // Counted with the same filters, so "the first 200 of N" is N for this
      // list rather than for the workspace.
      { count: "exact" },
    )
    .eq("workspace_id", session.workspaceId);

  if (showing === "contacted") query = query.not("last_contacted_at", "is", null);
  if (showing === "new") query = query.is("last_contacted_at", null);
  if (strategy) query = query.eq("customer_profile_id", strategy.id);
  // Every word has to appear somewhere — "Jane Acme" finds Jane at Acme — and
  // each may be in any of the four fields a person is recognised by.
  for (const word of words) {
    const pattern = containsPattern(word);
    query = query.or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},company.ilike.${pattern},title.ilike.${pattern}`,
    );
  }

  const { data: prospects, count: matching } = await query
    // Contacted first, most recent first, on every view: this page is the
    // history (rule 24). Within the never-contacted, best fit first, which is
    // the order a list is built in.
    .order("last_contacted_at", { ascending: false, nullsFirst: false })
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(PAGE_LIMIT);

  // Counted within the strategy being viewed, not across the workspace. A
  // header reading "412 in this workspace, 9 contacted" above a list of
  // eighteen is two unrelated facts stacked on one line.
  const scopeCount = (build: (q: ReturnType<typeof countQuery>) => ReturnType<typeof countQuery>) =>
    build(countQuery());
  function countQuery() {
    const q = supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId);
    return strategy ? q.eq("customer_profile_id", strategy.id) : q;
  }

  const shownIds = (prospects ?? []).map((p) => p.id);
  const [{ count: contactedCount }, { count: totalCount }, { rows: perStrategy }, { data: placements }, { data: campaigns }] =
    await Promise.all([
      scopeCount((q) => q.not("last_contacted_at", "is", null)),
      scopeCount((q) => q),
      // One row per prospect, reduced below. A count per strategy would be one
      // query per strategy, and a business is expected to run twenty of them.
      // Paged, because a plain select stops at the thousandth row without
      // saying so, and every tab then read 1,000 against a header that said
      // more.
      fetchAllRows<{ customer_profile_id: string | null }>((from, to) =>
        supabase
          .from("prospects")
          .select("customer_profile_id")
          .eq("workspace_id", session.workspaceId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      // Where each person on screen got to. `campaign_prospects` is the record,
      // read through the inbox's own stage reading so the two screens agree.
      shownIds.length
        ? supabase
            .from("campaign_prospects")
            .select("prospect_id, campaign_id, status, invited_at, accepted_at, replied_at, last_step_sent")
            .eq("workspace_id", session.workspaceId)
            .in("prospect_id", shownIds)
        : Promise.resolve({ data: [] as CampaignRow[] }),
      supabase.from("campaigns").select("id, name, status").eq("workspace_id", session.workspaceId).limit(500),
    ]);

  const countByStrategy = new Map<string, number>();
  for (const row of perStrategy ?? []) {
    const key = row.customer_profile_id ?? "none";
    countByStrategy.set(key, (countByStrategy.get(key) ?? 0) + 1);
  }
  const strategyNames = new Map(strategyList.map((s) => [s.id, s.name]));
  const campaignById = new Map((campaigns ?? []).map((c) => [c.id, c]));

  /*
   * The furthest any campaign got with each person. Rule 24 means there is
   * almost always one row, but a person queued on two drafts built from the
   * same customer profile is legitimate until one of them sends, and the
   * further one is the true answer.
   */
  const placementByProspect = new Map<string, { row: CampaignRow; stage: InboxStage | null }>();
  for (const row of (placements ?? []) as CampaignRow[]) {
    const stage = inboxStageOf(row);
    const current = placementByProspect.get(row.prospect_id);
    const rank = stage ? STAGE_RANK[stage] : 0;
    const currentRank = current?.stage ? STAGE_RANK[current.stage] : current ? 0 : -1;
    if (rank > currentRank) placementByProspect.set(row.prospect_id, { row, stage });
  }

  /*
   * Whether anybody on this list has an intent signal at all.
   *
   * Signals arrive from campaign activity, so a workspace in its first
   * fortnight has none — and the "Why" column stood over a row of empty cells
   * on the screen a rep reads to decide who to write to next. Width taken from
   * the columns that do have something in them.
   */
  const anySignals = (prospects ?? []).some(
    (prospect) => Array.isArray(prospect.signals) && prospect.signals.length > 0,
  );

  const nav = (
    <ProspectNav everyone={menu.everyone} review={menu.review} searchable={menu.searchable} excluded={menu.excluded} />
  );

  /*
   * The whole-page empty state is for a workspace with nobody in it at all.
   *
   * It used to fire whenever the list came back empty under "Everyone" — so
   * choosing a strategy that had found nobody yet replaced the filters with
   * "No prospects yet. Approve a strategy", and the only way back to the list
   * was the browser's Back button.
   */
  const filtered = Boolean(strategy || words.length || showing !== "all");
  if (!prospects?.length && !filtered && perStrategy.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Work"
          title="Prospects"
          lede="Everyone this workspace has found, and who has been reached out to."
        />
        <PageNotice error={params.error} notice={params.notice} />
        <SectionLayout nav={nav}>
          <Empty title="No prospects yet." action="Find people" href="/app/prospects/find">
            A strategy produces a search, and a search produces this list. Nobody is contacted until
            you have read the names and the copy.
          </Empty>
        </SectionLayout>
      </>
    );
  }

  const here = listHref({ strategy: strategy?.id, show: showing, q: search });
  const shown = prospects?.length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Prospects"
        lede={
          <>
            {totalCount ?? 0} {totalCount === 1 ? "person" : "people"}{" "}
            {strategy ? `found by “${strategy.name}”` : "found so far"}, {contactedCount ?? 0} contacted.
            Nobody is ever contacted twice, even from a different campaign.
          </>
        }
        actions={
          // Everybody who answered, by where it is going: the pipeline this
          // list feeds.
          <Link className="btn ghost small" href="/app/opportunities">
            See who answered
          </Link>
        }
      />
      <PageNotice error={params.error} notice={params.notice} />
      <SectionLayout nav={nav}>
        {/*
          Two filters, kept separate because they answer different questions:
          which market a person came from, and whether we have written to them.
          Folded into one row they read as alternatives, and "Contacted" would
          look like a strategy.
        */}
        <div className="stack-3">
          {strategyList.length > 0 ? (
            <nav className="tabs" aria-label="Which strategy found them">
              <Link
                className={`pill ${strategy ? "" : "accent"}`}
                href={listHref({ show: showing, q: search })}
                aria-current={strategy ? undefined : "page"}
              >
                All strategies ({perStrategy.length})
              </Link>
              {strategyList.map((s) => (
                <Link
                  key={s.id}
                  className={`pill ${strategy?.id === s.id ? "accent" : ""}`}
                  href={listHref({ strategy: s.id, show: showing, q: search })}
                  aria-current={strategy?.id === s.id ? "page" : undefined}
                  title={s.name}
                >
                  {shortName(s.name)} ({countByStrategy.get(s.id) ?? 0})
                </Link>
              ))}
              {countByStrategy.get("none") ? (
                // Named rather than hidden. These are people found before the
                // link existed, and a count that does not add up is its own
                // question somebody has to chase.
                <span className="pill" title="Found before prospects recorded their strategy">
                  No strategy ({countByStrategy.get("none")})
                </span>
              ) : null}
            </nav>
          ) : null}

          <nav className="tabs" aria-label="Which prospects to show">
            {(
              [
                { key: "all", label: `Everyone (${totalCount ?? 0})` },
                { key: "contacted", label: `Contacted (${contactedCount ?? 0})` },
                { key: "new", label: `Not yet contacted (${Math.max(0, (totalCount ?? 0) - (contactedCount ?? 0))})` },
              ] as const
            ).map((tab) => (
              <Link
                key={tab.key}
                className={`pill ${showing === tab.key ? "accent" : ""}`}
                href={listHref({ strategy: strategy?.id, show: tab.key, q: search })}
                aria-current={showing === tab.key ? "page" : undefined}
              >
                {tab.label}
              </Link>
            ))}
          </nav>

          {/* The search box, here as well as in the top bar, so a filtered
              list can be narrowed without losing its filters. */}
          <form method="get" action="/app/prospects" className="prospect-search" role="search">
            {strategy ? <input type="hidden" name="strategy" value={strategy.id} /> : null}
            {showing !== "all" ? <input type="hidden" name="show" value={showing} /> : null}
            <label className="sr-only" htmlFor="prospect-q">
              Search prospects
            </label>
            <input
              id="prospect-q"
              type="search"
              name="q"
              defaultValue={search}
              autoComplete="off"
              spellCheck={false}
              placeholder="Name, company or job title…"
            />
            <button className="btn secondary small" type="submit">
              Search
            </button>
            {search ? <Link href={listHref({ strategy: strategy?.id, show: showing })}>Clear</Link> : null}
          </form>
        </div>

        {shown === 0 ? (
          // Said under the filters rather than instead of them, so the way back
          // to a list with people in it is still on the screen.
          <Empty
            title={
              search
                ? `Nobody here matches “${search}”.`
                : showing === "contacted"
                  ? "Nobody here has been contacted yet."
                  : showing === "new"
                    ? "Everybody here has been contacted."
                    : "This strategy has not found anybody yet."
            }
          >
            {search
              ? "Search looks at first and last names, companies and job titles. Try fewer words, or clear the search."
              : strategy
                ? "Its search runs once it is approved, and people appear here as it finds them. Choose another strategy above to see theirs."
                : "Choose another filter above to see the rest of the list."}
          </Empty>
        ) : null}

        {matching !== null && matching > shown ? (
          // Two hundred rows is where this list stops reading, and it used to
          // stop silently — the 201st person looked like they did not exist.
          <p className="small muted">
            Showing the first {shown.toLocaleString()} of {matching.toLocaleString()}. Choose a strategy
            or search to narrow it.
          </p>
        ) : null}

        {shown > 0 ? (
          <div className="table-scroll card-rows prospect-table">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Company</th>
                  <th className="num">Fit</th>
                  {/*
                    Intent and its reasons arrive together or not at all.
                    Signals come from campaign activity, so a workspace in its
                    first fortnight has none, and two columns of zeros and
                    blanks stood on the screen a rep reads to decide who to
                    write to next. They come back the moment there is anything
                    to put in them, together, because a score with no reason
                    beside it is a number nobody can act on.
                  */}
                  {anySignals ? <th className="num">Intent</th> : null}
                  {anySignals ? <th>Why</th> : null}
                  <th>Stage</th>
                  <th>Last contact</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(prospects ?? []).map((prospect) => {
                  const signals = Array.isArray(prospect.signals) ? (prospect.signals as unknown as Signal[]) : [];
                  const reasons = Array.isArray(prospect.fit_reasons) ? (prospect.fit_reasons as string[]) : [];
                  const placed = placementByProspect.get(prospect.id);
                  const campaign = placed ? campaignById.get(placed.row.campaign_id) : undefined;
                  const scoredAgainst = prospect.customer_profile_id
                    ? strategyNames.get(prospect.customer_profile_id)
                    : undefined;
                  const name = displayName(prospect);
                  return (
                    <tr key={prospect.id}>
                      <td data-label="Person">
                        {/* A name is whatever we actually know; the headline
                            stands in when the search returned none. Not every
                            profile has a public address: LinkedIn hides the
                            vanity URL outside your network, and a link to the
                            provider id 404s, which reads as an invented list. */}
                        {isPublicProfileUrl(prospect.linkedin_url, prospect.provider_id) ? (
                          <a
                            className="strongish"
                            href={profileHref(prospect.linkedin_url) ?? undefined}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {name}
                          </a>
                        ) : (
                          <span
                            className="strongish"
                            title="This profile has no public LinkedIn address. They can still be invited and messaged."
                          >
                            {name}
                          </span>
                        )}
                        {prospect.headline && prospect.headline !== name ? (
                          <span className="prospect-headline small muted" title={prospect.headline}>{prospect.headline}</span>
                        ) : null}
                      </td>
                      <td data-label="Company">
                        {prospect.company || prospect.title ? (
                          <>
                            {prospect.company ?? ""}
                            {prospect.title ? <span className="tiny subtle block">{prospect.title}</span> : null}
                          </>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                      {/*
                        A fit score is a fact about a person AND a strategy: 87
                        against "small B2B agencies" says nothing about how well
                        they fit "chamber leaders" (rule 26). So the score is
                        never shown without the strategy it was scored against.
                        `num`, not `mono`: Geist has real tabular figures, and
                        a monospace would set the strategy's name like code.
                      */}
                      <td data-label="Fit" className="num">
                        {prospect.fit_score ?? "—"}
                        {scoredAgainst ? (
                          <Link
                            className="tiny subtle prospect-fit-vs"
                            href={`/app/strategy/${prospect.customer_profile_id}`}
                            title={scoredAgainst}
                          >
                            for {shortName(scoredAgainst)}
                          </Link>
                        ) : (
                          <span className="tiny subtle block">No strategy</span>
                        )}
                      </td>
                      {anySignals ? (
                        <td data-label="Intent" className="num">
                          {prospect.intent_score ?? 0}
                        </td>
                      ) : null}
                      {anySignals ? (
                        <td data-label="Why" className="medium">
                          <div className="cluster">
                            {signals.slice(0, 3).map((signal, index) => (
                              <span key={index} className="pill accent" title={signal.detail}>
                                {SIGNAL_LABELS[signal.type] ?? signal.type}
                              </span>
                            ))}
                          </div>
                          <span className="small muted">{reasons.join("; ")}</span>
                        </td>
                      ) : null}
                      <td data-label="Stage">
                        {prospect.do_not_contact ? (
                          <span className="pill danger">Do not contact</span>
                        ) : placed ? (
                          <>
                            <span
                              className={`pill ${placed.stage === "booked" || placed.row.status === "positive" ? "positive" : placed.stage === "replied" ? "accent" : "plain"}`}
                            >
                              {placed.stage && ENDED.has(placed.row.status)
                                ? `${STAGE_LABELS[placed.stage]} · ${label(placed.row.status)}`
                                : label(placed.row.status)}
                            </span>
                            {campaign ? (
                              <Link className="tiny subtle block" href={`/app/campaigns/${campaign.id}`}>
                                {campaign.name}
                                {campaign.status === "draft" ? " · not launched" : ""}
                              </Link>
                            ) : null}
                          </>
                        ) : (
                          <span className="pill plain">Not on a campaign</span>
                        )}
                      </td>
                      <td data-label="Last contact">
                        {prospect.last_contacted_at ? (
                          // The date, not just the fact. "Contacted" alone cannot
                          // answer the question somebody opens this page with,
                          // which is when, and therefore whether it was this
                          // campaign or one from two months ago.
                          <time
                            dateTime={isoAttr(prospect.last_contacted_at)}
                            title={formatDateTime(prospect.last_contacted_at, timezone)}
                          >
                            {formatDate(prospect.last_contacted_at, timezone)}
                          </time>
                        ) : (
                          <span className="small subtle">Not yet</span>
                        )}
                      </td>
                      <td data-label="Actions">
                        {prospect.do_not_contact ? null : (
                          <form
                            action={eraseProspect}
                            title="Delete everything we hold about this person, keeping only a do-not-contact record"
                          >
                            <input type="hidden" name="prospectId" value={prospect.id} />
                            <input type="hidden" name="prospectName" value={name} />
                            <input type="hidden" name="back" value={here} />
                            {/* Two presses: erasure cannot be undone, and it sat
                                one misclick away on every row of the list. */}
                            <ConfirmButton className="btn ghost small" confirmLabel="Erase for good" pendingLabel="Erasing…">
                              Erase<span className="sr-only"> {name}</span>
                            </ConfirmButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionLayout>
    </>
  );
}
