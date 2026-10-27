import Link from "next/link";
import { BusinessProfileSchema } from "@le/shared";
import { PageNotice } from "@/components/page-notice";
import { Empty, PageHeader, Section } from "@/components/page";
import { SectionLayout } from "@/components/section-nav";
import { StrategyNav } from "@/components/strategy-nav";
import { StrategyFacts } from "@/components/strategy-facts";
import { StrategySearchNotices } from "@/components/strategy-notices";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readStrategyState } from "@/lib/strategy-state";
import { SEARCH_EVENTS, describeLastSearch } from "@/lib/last-search";
import { StrategyStatus } from "@/components/strategy-status";
import { StrategyDetailsForm, StrategyRetryButton } from "@/components/strategy-retry";
import { hasStrategySource, readOnboardingStash } from "@/lib/onboarding-stash";
import { formatDateTime, isoAttr } from "@/lib/format";
import { businessLabel, loadStrategyMenu, strategyName, strategyState } from "./data";

/**
 * The Strategy Agent's output, and the only place after setup it can be
 * approved (rule 9).
 *
 * It was one page scrolled from top to bottom: the business profile, then
 * every strategy as a full card with its pains, openers and search form, then
 * a form for another business. A workspace with fifteen strategies had to
 * scroll past fourteen of them to find the one it came to approve. It is now a
 * menu — the business profile here, each strategy on its own page
 * (`/app/strategy/[id]`), and asking Sage for more on its own — with the same
 * actions (`./actions.ts`), so nothing that could be done before has moved
 * out of reach.
 */
export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; business?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  // The last time the Targeting Agent gave up, and why.
  //
  // The agent runs in the worker, so the page that started it never learns how
  // it went. Pressing "find prospects" and coming back to the same empty list
  // was indistinguishable from pressing nothing at all — which is exactly how
  // this shipped, and exactly what got reported.
  const [{ data: lastStop }, { data: account }, { data: me }, menu] = await Promise.all([
    supabase
      .from("events")
      .select("name, payload, created_at")
      .eq("workspace_id", session.workspaceId)
      // The completion events too. Without them a search that worked left its
      // own `targeting.queued` as the newest row, and every success was reported
      // as a worker that never finished (`describeLastSearch`).
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
    // Times in the rep's own timezone, not the server's.
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    loadStrategyMenu(supabase, session.workspaceId),
  ]);
  const timezone = me?.timezone ?? null;
  const lastSearch = describeLastSearch(lastStop);
  const { businesses, profiles: allProfiles, yieldByStrategy } = menu;

  // `?business=` picks one, and an id that is not this workspace's falls back
  // to the first rather than to an empty page: a stale bookmark should show
  // something true, not "nothing here yet".
  const businessRow = businesses.find((row) => row.id === params.business) ?? businesses[0] ?? null;

  if (!businessRow) {
    // "Has not finished yet, or it has not run" was the whole of what this page
    // could say, and those are different situations with different things to do
    // about them — one of them being a failed run that will never finish on its
    // own. The agent records where it got to; this reads that.
    const strategy = await readStrategyState(supabase, session.workspaceId, false);
    // What onboarding kept for Sage to read. A workspace set up before it was
    // kept has nothing here, and then the only way forward is to say it again —
    // on this page, because `/onboarding` sends anybody with a workspace away.
    const { data: ws } = await supabase
      .from("workspaces")
      .select("onboarding")
      .eq("id", session.workspaceId)
      .maybeSingle();
    const source = readOnboardingStash(ws?.onboarding).source;
    const known = hasStrategySource(source);
    return (
      <>
        <PageHeader eyebrow="Setup" title="Strategies" />
        {/* The retry reports back through the URL, and this branch is the
            only place it can land while there is no profile yet. */}
        <PageNotice error={params.error} notice={params.notice} />
        <StrategyStatus state={strategy} />
        {strategy.phase === "absent" && known ? (
          <div className="notice">
            <p>
              <strong>Nothing here yet.</strong> Sage, your strategist, reads what you publish and drafts
              your business profile and three to five customer profiles. It has not been asked to
              yet.
            </p>
            <StrategyRetryButton>Start Sage</StrategyRetryButton>
          </div>
        ) : null}
        {/* Asked here when there is nothing to retry from, and offered after a
            failure too: the reason a run fails is often the site it was given. */}
        {(strategy.phase === "absent" && !known) || strategy.phase === "failed" ? (
          <Section
            id="details"
            title={strategy.phase === "failed" ? "Or change what Sage reads" : "Tell Sage what you sell"}
            description="Sage reads what you publish and drafts your business profile and three to five customer profiles. Nothing is searched for until you approve one."
          >
            <StrategyDetailsForm source={source} />
          </Section>
        ) : null}
      </>
    );
  }

  const business = BusinessProfileSchema.safeParse(businessRow.spec);
  // This business's strategies, not the workspace's. Unfiltered, a workspace
  // running two showed one business's profile above both lists, so a rep
  // approving "Chamber leaders" could not tell which company it was for.
  const profiles = allProfiles.filter((row) => row.business_profile_id === businessRow.id);
  const connected = account?.status === "active";
  const businessHref = businesses.length > 1 ? `/app/strategy?business=${businessRow.id}` : "/app/strategy";
  const strategyCount = new Map<string, number>();
  for (const row of allProfiles) {
    strategyCount.set(row.business_profile_id, (strategyCount.get(row.business_profile_id) ?? 0) + 1);
  }
  const waiting = profiles.filter((row) => strategyState(row) === "waiting" && row.name?.trim()).length;
  const approvedCount = profiles.filter((row) => strategyState(row) === "approved").length;
  const firstWaiting = profiles.find((row) => strategyState(row) === "waiting" && row.name?.trim()) ?? null;
  const foundTotal = profiles.reduce((sum, row) => sum + (yieldByStrategy.get(row.id)?.found ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Strategies"
        lede="Who Nora goes after, written by Sage from what you publish. Nothing is searched for until you approve a strategy."
        /*
          No header button. "Write more strategies" sat here and "Ask Sage
          for more" in the menu beside it: two doors to one room, and the one
          in the menu also offers different strategies and a second business.
        */
      />

      <PageNotice error={params.error} notice={params.notice} />

      {/*
        Silent for a workspace with one business, which is almost all of them.
        A tab row that never has a second tab is a control that only ever says
        "you are where you already were".
      */}
      {businesses.length > 1 ? (
        <nav className="tabs" aria-label="Which business these strategies are for">
          {businesses.map((row) => (
            <Link
              key={row.id}
              className={`pill ${row.id === businessRow.id ? "accent" : ""}`}
              href={`/app/strategy?business=${row.id}`}
              aria-current={row.id === businessRow.id ? "page" : undefined}
            >
              {businessLabel(row)} ({strategyCount.get(row.id) ?? 0})
            </Link>
          ))}
        </nav>
      ) : null}

      {/* Reported whether or not the run failed loudly: the interesting case is
          the one that succeeded at doing nothing. Written out here rather than
          through `StrategySearchNotices`, because this is the line the
          mutation check guards (rule 54). */}
      {lastSearch ? (
        <div className={lastSearch.tone === "warning" ? "notice warning" : "notice"} role="status">
          <p>
            <strong>{lastSearch.title}</strong> {lastSearch.body}
          </p>
          {/* When, and nothing else. The payload is the worker's record —
              build ids and internal fields — and never the customer's to read
              (rule 54). */}
          <p className="tiny subtle">
            <time dateTime={isoAttr(lastSearch.at)}>{formatDateTime(lastSearch.at, timezone)}</time>
          </p>
        </div>
      ) : null}
      <StrategySearchNotices lastSearch={null} timezone={timezone} connected={connected} />

      <SectionLayout
        nav={
          <StrategyNav
            businessHref={businessHref}
            businessName={businessLabel(businessRow)}
            strategies={profiles.map((row) => ({
              ...row,
              found: yieldByStrategy.get(row.id)?.found ?? 0,
              campaigns: yieldByStrategy.get(row.id)?.campaigns ?? 0,
            }))}
          />
        }
      >
        <Section id="business" title="Business profile">
          {business.success ? (
            <div className="card">
              <h3>{business.data.companyName}</h3>
              <p>{business.data.oneLiner}</p>
              <p className="small muted">{business.data.offering}</p>
              <div className="grid grid-3">
                <StrategyFacts label="Tone of voice" values={[business.data.toneOfVoice]} />
                <StrategyFacts label="Proof points" values={business.data.proofPoints} />
                <StrategyFacts label="Differentiators" values={business.data.differentiators} />
                <StrategyFacts label="Objections we hear" values={business.data.commonObjections} />
              </div>
            </div>
          ) : (
            <div className="notice danger">
              <p>This business profile can no longer be read. Press Write more strategies, or ask us through Support.</p>
            </div>
          )}
        </Section>

        {/*
          A short summary, never a second list. The strategies were listed
          twice on one screen: as the menu beside this pane and again as a
          table in it. The menu is the navigation; this says where things
          stand and what to press next. On a phone the menu is a row of tabs
          carrying the names, so nothing here depends on its hints.
        */}
        <Section id="strategies" title="Your strategies">
          {profiles.length === 0 ? (
            // A business with no strategies rendered its heading over nothing,
            // which reads as a list that failed to load.
            <Empty title="No strategies for this business yet." action="Ask Sage for some" href="/app/strategy/more">
              Sage drafts them from this business profile. Nothing is searched for until you approve one.
            </Empty>
          ) : (
            <div className="card strategy-summary">
              <p>
                <strong>{summaryLine(profiles.length, approvedCount, waiting)}</strong>
              </p>
              <p className="small muted">
                {foundTotal > 0
                  ? `${foundTotal.toLocaleString()} ${foundTotal === 1 ? "person" : "people"} found so far. Pick a strategy from the menu to read it, change who it looks for, or approve it.`
                  : "Pick a strategy from the menu to read it, change who it looks for, or approve it."}
              </p>
              <div className="strategy-summary-actions">
                {firstWaiting ? (
                  <Link className="btn" href={`/app/strategy/${firstWaiting.id}`}>
                    Read {strategyName(firstWaiting)}
                  </Link>
                ) : null}
                <Link className={firstWaiting ? "btn secondary" : "btn"} href="/app/strategy/more">
                  Ask Sage for more
                </Link>
              </div>
            </div>
          )}
        </Section>
      </SectionLayout>
    </>
  );
}

/** Where a business's strategies stand, in one sentence. */
function summaryLine(total: number, approved: number, waiting: number): string {
  const parts = [`${total} ${total === 1 ? "strategy" : "strategies"}`];
  const states: string[] = [];
  if (approved) states.push(`${approved} approved`);
  if (waiting) states.push(`${waiting} waiting for you to read`);
  return states.length ? `${parts[0]}: ${states.join(", ")}.` : `${parts[0]}.`;
}
