import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, fitCutoffSentence, profileHref, renderMerge } from "@le/shared";
import { plainReason } from "@le/linkedin";
import { Empty, Section } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { formatDate, isoAttr } from "@/lib/format";
import { label } from "@/lib/labels";
import { FIND_MORE_BATCH, listInWords, loadCampaign, nameOf, personOf, ruleStrings } from "../data";
import { findMore, removeFromCampaign, retryFailed, saveInviteNote } from "../actions";
import { sectionHref } from "../sections";

/**
 * Who is on the list, and what each of them receives.
 *
 * The review this product is built on happens here: every name, why they are
 * on it, and the note written for them, editable until they are invited. The
 * list grows a page at a time from the same search (Find more), and anybody a
 * send failed for can be put back.
 *
 * A filter, because a campaign a few hundred deep is mostly people already
 * reached, and the ones still waiting for review are the ones somebody opens
 * this for. The filter is in the address, so a reload or a shared link keeps it.
 */
const FILTERS = [
  { key: "all", title: "Everyone" },
  { key: "waiting", title: "Still to invite" },
  { key: "reached", title: "Reached" },
  { key: "failed", title: "Failed" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

export default async function CampaignPeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; show?: string }>;
}) {
  const query = await searchParams;
  const { id } = await params;
  const { campaign, rows, failed, searchNotice, viewerTimezone, sendingPlan } = await loadCampaign(id);

  const dropped = ruleStrings(campaign.rules, "droppedFilters");
  // What the words in the customer profile actually became. LinkedIn searches
  // places and industries by id, so every one of them was translated first.
  const filterNotes = ruleStrings(campaign.rules, "filterNotes");

  const matches: Record<Filter, (row: (typeof rows)[number]) => boolean> = {
    all: () => true,
    waiting: (row) => row.status === "queued",
    reached: (row) => Boolean(row.invited_at),
    failed: (row) => row.status === "failed",
  };
  const show: Filter = FILTERS.some((f) => f.key === query.show) ? (query.show as Filter) : "all";
  const shown = rows.filter(matches[show]);
  const here = sectionHref(campaign.id, "people");

  return (
    <>
      <PageNotice error={query.error} notice={query.notice} />

      {dropped.length > 0 && sendingPlan === "sales_navigator" ? (
        // A seat that refused part of the search, or a word with no Sales
        // Navigator level. Neither is "built without Sales Navigator", and
        // telling somebody who has it to turn it on is advice they cannot take.
        <div className="notice">
          <strong>Some of your customer profile was not applied</strong>
          <p className="small">
            This search did not filter on {listInWords(dropped)}. Each person was still scored
            against the full profile, and the notes below say what changed. Read the names before
            launching.
          </p>
        </div>
      ) : dropped.length > 0 ? (
        <div className="notice">
          <strong>This list was built without Sales Navigator</strong>
          <p className="small">
            Classic LinkedIn search cannot filter on {listInWords(dropped)}, so{" "}
            {dropped.length === 1 ? "that part" : "those parts"} of your customer profile
            {dropped.length === 1 ? " was" : " were"} not applied. The list was searched by job
            title, industry and location as far as LinkedIn allowed, and each person was scored
            against the full profile. The notes below say what else changed. Read the names before
            launching, and expect more of them to be wrong than usual.
          </p>
          <p className="small">
            <Link href="/app/profile#sales-navigator">Have Sales Navigator? Turn it on</Link> and
            the next search applies every filter.
          </p>
        </div>
      ) : null}

      {filterNotes.length > 0 ? (
        <div className="notice">
          <strong>How your customer profile was searched</strong>
          <p className="small">
            LinkedIn searches locations and industries by its own identifiers, not by name, so each
            one had to be looked up first. Read these before the names below: a term that was left
            out is a filter this list does not have.
          </p>
          <ul className="bullets">
            {filterNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {searchNotice ? (
        <div className={searchNotice.tone === "danger" ? "notice danger" : "notice"} role="status">
          <strong>{searchNotice.title}</strong>
          <p className="small">{searchNotice.body}</p>
        </div>
      ) : null}

      <div className="campaign-actions-row">
        {/*
          One list grown a page at a time, rather than a new campaign per page.
          Everyone already on it is excluded from the next read, so the list
          only ever gets longer and nobody appears on it twice.

          A card is the surface and `between` is the arrangement inside it, so
          they go on different elements: `.card` declares a column and wins
          on source order over a `.between` on the same element.
        */}
        <form action={findMore} className="card action-card">
          <div className="action-card-text">
            <p>
              <strong>Need more people?</strong>
            </p>
            <p className="small muted">
              {campaign.search_exhausted
                ? "LinkedIn has nobody else matching this strategy. Widen who it looks for on the Strategies page to reach more people."
                : !campaign.customer_profile_id
                  ? "The strategy this list came from has been deleted, so there is nothing left to search for."
                  : `Nora looks at the next ${FIND_MORE_BATCH} people from the same search and adds anybody new. Nobody already on a list is added twice.`}
            </p>
            {campaign.searched_at && !searchNotice ? (
              <p className="tiny subtle">
                Last searched{" "}
                <time dateTime={isoAttr(campaign.searched_at)}>{formatDate(campaign.searched_at, viewerTimezone)}</time>
              </p>
            ) : null}
          </div>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <SubmitButton
            className="btn secondary"
            pendingLabel="Searching…"
            disabled={campaign.search_exhausted || !campaign.customer_profile_id}
          >
            Find {FIND_MORE_BATCH} more
          </SubmitButton>
        </form>

        {failed.length > 0 ? (
          <form action={retryFailed} className="card action-card">
            <div className="action-card-text">
              <p>
                <strong>
                  {failed.length} {failed.length === 1 ? "invitation" : "invitations"} did not go out
                </strong>
              </p>
              <p className="small muted">
                Nothing was sent to them, so nothing was spent. Trying again puts them back in line,
                and every safety check runs again first.
              </p>
            </div>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <SubmitButton className="btn secondary" pendingLabel="Requeueing…">
              Try {failed.length} again
            </SubmitButton>
          </form>
        ) : null}
      </div>

      <Section
        id="list"
        title="Who is on the list"
        description={fitCutoffSentence()}
        action={
          <p className="tiny subtle">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
        }
      >
        {rows.length > 0 ? (
          <nav className="campaign-filter" aria-label="Show">
            {FILTERS.filter((f) => f.key !== "failed" || failed.length > 0).map((f) => {
              const n = rows.filter(matches[f.key]).length;
              return (
                <Link
                  key={f.key}
                  href={f.key === "all" ? here : `${here}?show=${f.key}`}
                  className={f.key === show ? "is-active" : undefined}
                  aria-current={f.key === show ? "page" : undefined}
                >
                  {f.title} <span className="nums">{n}</span>
                </Link>
              );
            })}
          </nav>
        ) : null}

        {rows.length === 0 ? (
          <Empty title="Nobody is on this list yet.">
            {campaign.customer_profile_id && !campaign.search_exhausted
              ? `Press Find ${FIND_MORE_BATCH} more above to read the next page of the search.`
              : "People appear here when a search finds them. Nothing is sent until you launch."}
          </Empty>
        ) : shown.length === 0 ? (
          <Empty title="Nobody here.">Nobody on this list is in that state right now.</Empty>
        ) : (
          <ul className="prospect-list">
            {shown.map((row) => {
              const prospect = personOf(row);
              if (!prospect) return null;

              const name = nameOf(prospect);
              const grounding = (row.invite_note_grounding ?? []) as string[];
              const queued = row.status === "queued";
              // The campaign's standard note as this person would read it:
              // their name and company filled in, never the raw {{…}} fields.
              const standard = renderMerge(campaign.connection_note ?? "", {
                first_name: prospect.first_name,
                last_name: prospect.last_name,
                company: prospect.company,
                title: prospect.title,
                location: prospect.location,
              });

              return (
                <li key={row.id} className="card prospect-card">
                  <div className="between">
                    <div className="stack-1 grow">
                      <div className="cluster">
                        <a href={profileHref(prospect.linkedin_url) ?? undefined} target="_blank" rel="noreferrer">
                          <strong>{name}</strong>
                        </a>
                        {prospect.fit_score !== null ? (
                          <span className="pill plain tiny nums" title="How closely they match the strategy, out of 100">
                            Match {prospect.fit_score}
                          </span>
                        ) : null}
                        <span className={`pill tiny ${row.status === "meeting_booked" ? "positive" : "plain"}`}>
                          {label(row.status)}
                        </span>
                      </div>
                      <p className="small muted">
                        {prospect.title ?? prospect.headline ?? "No title given"}
                        {prospect.company ? ` · ${prospect.company}` : ""}
                        {prospect.location ? ` · ${prospect.location}` : ""}
                      </p>
                    </div>
                    {queued ? (
                      <form action={removeFromCampaign}>
                        <input type="hidden" name="campaignProspectId" value={row.id} />
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <input type="hidden" name="prospectName" value={name} />
                        {/* Two presses: a removed person is closed on this
                            campaign and is never put back on it. */}
                        <ConfirmButton className="btn ghost small" confirmLabel="Remove for good" pendingLabel="Removing…">
                          Remove<span className="sr-only"> {name}</span>
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </div>

                  {prospect.fit_reasons?.length ? (
                    <div className="stack-1">
                      <p className="tiny subtle">Why this person</p>
                      <ul className="bullets small muted">
                        {prospect.fit_reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* What this person actually receives. Until notes existed
                      everyone in a campaign got identical words, and this is
                      the screen where that is now visible before it is sent. */}
                  <div className="stack-2">
                    <div className="cluster">
                      <p className="tiny subtle">Their connection note</p>
                      {row.invite_note_edited ? (
                        <span className="pill plain tiny">edited by you</span>
                      ) : row.invite_note_thin ? (
                        <span className="pill warning tiny">too little to go on</span>
                      ) : !row.invite_note ? (
                        <span className="pill warning tiny">standard note</span>
                      ) : null}
                    </div>

                    {queued ? (
                      <form action={saveInviteNote} className="stack-2">
                        <input type="hidden" name="campaignProspectId" value={row.id} />
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <input type="hidden" name="prospectName" value={name} />
                        <label className="field">
                          <span className="sr-only">Connection note for {name}</span>
                          <textarea
                            name="note"
                            rows={3}
                            maxLength={INVITE_NOTE_MAX_CHARS}
                            defaultValue={row.invite_note ?? ""}
                            placeholder={standard}
                          />
                        </label>
                        <div className="between">
                          {/* A static "120/200" read like a live counter and
                              never moved as somebody typed; the limit is what
                              matters, and the field enforces it. */}
                          <p className="tiny subtle">
                            Up to {INVITE_NOTE_MAX_CHARS} characters. Leave it empty to send the standard note.
                          </p>
                          <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                            Save note
                          </SubmitButton>
                        </div>
                      </form>
                    ) : (
                      <blockquote className="quote small">{row.invite_note ?? standard}</blockquote>
                    )}

                    {grounding.length ? (
                      <p className="tiny subtle">Written from: {grounding.join(" · ")}</p>
                    ) : row.invite_note && !row.invite_note_edited ? (
                      <p className="tiny warning-text">
                        Nothing specific to this person. This note could have gone to anybody.
                      </p>
                    ) : null}
                  </div>

                  {row.status_reason ? <p className="tiny muted">{plainReason(row.status_reason)}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
