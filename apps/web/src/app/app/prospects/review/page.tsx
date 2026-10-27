import Link from "next/link";
import { isPublicProfileUrl, profileHref } from "@le/shared";
import { Empty, PageHeader, Section } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { SectionLayout } from "@/components/section-nav";
import { ProspectNav } from "@/components/prospect-nav";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { formatDate, isoAttr } from "@/lib/format";
import { displayName, loadProspectMenu, shortName } from "../data";

/** How many queued people the page reads across every draft. Said on screen when reached. */
const REVIEW_LIMIT = 300;

/**
 * Everybody about to be invited, before anybody is.
 *
 * A campaign is built as a draft and nothing is sent until a person has read
 * the names and the notes and pressed Launch — that is the product's central
 * claim. The names sat on each campaign's own page, so "who is waiting for me
 * to look at them" meant opening every draft in turn. This lists them all,
 * grouped by the campaign they are on, and sends the reviewer to that
 * campaign to read the copy and launch: the review itself happens there, with
 * every blocker and the competitor check beside it, never here.
 */
export default async function ProspectReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [menu, { data: strategies }, { data: me }] = await Promise.all([
    loadProspectMenu(supabase, session.workspaceId),
    supabase.from("customer_profiles").select("id, name").eq("workspace_id", session.workspaceId),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);
  const timezone = me?.timezone ?? null;
  const drafts = menu.draftCampaigns;
  const strategyNames = new Map((strategies ?? []).map((s) => [s.id, s.name]));

  const { data: queued } = drafts.length
    ? await supabase
        .from("campaign_prospects")
        .select("id, campaign_id, prospect_id, invite_note, created_at")
        .eq("workspace_id", session.workspaceId)
        .eq("status", "queued")
        .in(
          "campaign_id",
          drafts.map((c) => c.id),
        )
        .order("created_at", { ascending: true })
        .limit(REVIEW_LIMIT)
    : { data: [] as Array<{ id: string; campaign_id: string; prospect_id: string; invite_note: string | null; created_at: string }> };

  const prospectIds = [...new Set((queued ?? []).map((row) => row.prospect_id))];
  const { data: people } = prospectIds.length
    ? await supabase
        .from("prospects")
        .select("id, provider_id, first_name, last_name, headline, title, company, linkedin_url, fit_score, customer_profile_id")
        .eq("workspace_id", session.workspaceId)
        .in("id", prospectIds)
    : { data: [] as Array<{ id: string; provider_id: string | null; first_name: string | null; last_name: string | null; headline: string | null; title: string | null; company: string | null; linkedin_url: string; fit_score: number | null; customer_profile_id: string | null }> };
  const personById = new Map((people ?? []).map((p) => [p.id, p]));

  const byCampaign = new Map<string, NonNullable<typeof queued>>();
  for (const row of queued ?? []) {
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
  }
  const withPeople = drafts.filter((c) => byCampaign.has(c.id));
  const cut = (queued ?? []).length >= REVIEW_LIMIT;

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Prospects"
        lede="Everybody on a campaign nobody has launched yet. Nothing is sent to any of them until you read the names and the notes and press Launch."
      />
      <PageNotice error={params.error} notice={params.notice} />
      <SectionLayout
        nav={<ProspectNav everyone={menu.everyone} review={menu.review} searchable={menu.searchable} excluded={menu.excluded} />}
      >
        {withPeople.length === 0 ? (
          <Section title="Waiting for review">
            <Empty title="Nobody is waiting for review." action="Find new people" href="/app/prospects/find">
              When a search builds a campaign, its people wait here until you launch it.
            </Empty>
          </Section>
        ) : (
          <>
            {cut ? (
              <p className="small muted">
                Showing the first {REVIEW_LIMIT} people waiting, oldest first. Each campaign&rsquo;s own page
                has its whole list.
              </p>
            ) : null}
            {withPeople.map((campaign) => {
              const rows = byCampaign.get(campaign.id) ?? [];
              const strategy = campaign.customer_profile_id ? strategyNames.get(campaign.customer_profile_id) : null;
              return (
                <Section
                  key={campaign.id}
                  id={`draft-${campaign.id}`}
                  title={campaign.name}
                  description={
                    <>
                      {rows.length} {rows.length === 1 ? "person" : "people"} waiting
                      {strategy ? <> · found by {shortName(strategy)}</> : null} · built{" "}
                      <time dateTime={isoAttr(campaign.created_at)}>{formatDate(campaign.created_at, timezone)}</time>
                    </>
                  }
                  action={
                    <Link className="btn small" href={`/app/campaigns/${campaign.id}`}>
                      Review and launch
                    </Link>
                  }
                >
                  <div className="table-scroll card-rows prospect-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>Company</th>
                          <th className="num">Fit</th>
                          <th>Their note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const person = personById.get(row.prospect_id);
                          if (!person) return null;
                          const name = displayName(person);
                          // Scored against the strategy that found them (rule 26).
                          const scored = person.customer_profile_id
                            ? strategyNames.get(person.customer_profile_id)
                            : undefined;
                          return (
                            <tr key={row.id}>
                              <td data-label="Person">
                                {isPublicProfileUrl(person.linkedin_url, person.provider_id) ? (
                                  <a
                                    className="strongish"
                                    href={profileHref(person.linkedin_url) ?? undefined}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                  >
                                    {name}
                                  </a>
                                ) : (
                                  <span className="strongish">{name}</span>
                                )}
                                {person.headline && person.headline !== name ? (
                                  <span className="prospect-headline small muted" title={person.headline}>{person.headline}</span>
                                ) : null}
                              </td>
                              <td data-label="Company">
                                {person.company || "—"}
                                {person.title ? <span className="tiny subtle block">{person.title}</span> : null}
                              </td>
                              <td data-label="Fit" className="num">
                                {person.fit_score ?? "—"}
                                {scored ? (
                                  <span className="tiny subtle prospect-fit-vs" title={scored}>
                                    vs {shortName(scored)}
                                  </span>
                                ) : null}
                              </td>
                              <td data-label="Their note" className="prospect-note small">
                                {/* The note written for this person (rule 16), or
                                    the campaign's own when the writer produced
                                    none: said, never left blank. */}
                                {row.invite_note ?? <span className="subtle">The campaign&rsquo;s own note</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Section>
              );
            })}
          </>
        )}
      </SectionLayout>
    </>
  );
}
