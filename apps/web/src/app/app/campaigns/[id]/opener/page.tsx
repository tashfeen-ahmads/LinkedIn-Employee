import Link from "next/link";
import { MIN_SENDS_TO_COMPARE, usesPitch } from "@le/shared";
import { Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { loadCampaign } from "../data";
import { rewriteNotes } from "../actions";
import { sectionHref } from "../sections";

/**
 * What the campaign opens with and what it offers.
 *
 * The opener is the line every connection note leans on and the offer is what
 * `{{pitch}}` becomes when somebody replies (rule 40). Both are approved one
 * line at a time elsewhere; this says which approved line *this* campaign is
 * using, because a rep who approved three offers had no screen saying which of
 * them a given campaign sends. Then the notes themselves, and the angles under
 * test (rule 28).
 */
interface Line {
  id: string;
  name: string;
  body: string;
  approved_at: string | null;
  is_default: boolean;
  agent_id: string | null;
}

/**
 * The line a campaign uses, read the way the send path reads it: the agent's
 * own approved line first (its default ahead of the rest), then the
 * workspace's default with no agent, and only ever an approved one (rule 40,
 * `pitchFor` in the worker).
 */
function inUse(lines: Line[], agentId: string | null): { line: Line; source: "agent" | "workspace" } | null {
  const approved = lines.filter((l) => l.approved_at && l.body.trim());
  if (agentId) {
    const own = approved
      .filter((l) => l.agent_id === agentId)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default));
    if (own[0]) return { line: own[0], source: "agent" };
  }
  const fallback = approved.find((l) => l.agent_id === null && l.is_default);
  return fallback ? { line: fallback, source: "workspace" } : null;
}

export default async function CampaignOpenerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const { session, supabase, campaign, rows, onTemplate, steps, agent, variantRows, variantStandings, readyToCompare } =
    await loadCampaign(id);

  const [{ data: hookRows }, { data: pitchRows }] = await Promise.all([
    supabase
      .from("hooks")
      .select("id, name, body, approved_at, is_default, agent_id")
      .eq("workspace_id", session.workspaceId),
    supabase
      .from("pitches")
      .select("id, name, body, approved_at, is_default, agent_id")
      .eq("workspace_id", session.workspaceId),
  ]);
  const hooks = (hookRows ?? []) as Line[];
  const pitches = (pitchRows ?? []) as Line[];
  const opener = inUse(hooks, campaign.agent_id);
  const offer = inUse(pitches, campaign.agent_id);
  // A follow-up built from {{pitch}} with no approved offer is held, not sent
  // (rule 40) — said here, where the offer is, rather than discovered later.
  const needsOffer = steps.some((step) => usesPitch(step.message ?? ""));
  const personal = rows.length - onTemplate;
  const sourceWords = (source: "agent" | "workspace") =>
    source === "agent" && agent ? `${agent.name}’s approved line` : "your workspace’s default";

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />

      <Section
        id="lines"
        title="Opener and offer in use"
        description="Approved one line at a time on the Pitch page. A campaign uses its agent’s approved line, or your workspace’s default when the agent has none."
      >
        <div className="grid grid-2">
          <div className="card">
            <p className="tiny subtle">Opener · what every connection note leans on</p>
            {opener ? (
              <>
                <p>
                  <strong>{opener.line.name}</strong>
                </p>
                <blockquote className="quote small">{opener.line.body}</blockquote>
                <p className="tiny subtle">{sourceWords(opener.source)}. Each note is still written for its own person.</p>
              </>
            ) : (
              <p className="small muted">
                No approved opener, so each note is written from the person and the angle alone. Approve one
                and the next rewrite leans on it.
              </p>
            )}
          </div>
          <div className="card">
            <p className="tiny subtle">Offer · what the follow-ups and replies make</p>
            {offer ? (
              <>
                <p>
                  <strong>{offer.line.name}</strong>
                </p>
                <blockquote className="quote small">{offer.line.body}</blockquote>
                <p className="tiny subtle">{sourceWords(offer.source)}. Adapted to what they asked, never pasted.</p>
              </>
            ) : needsOffer ? (
              <div className="notice warning" role="note">
                <p className="small">
                  <strong>No approved offer.</strong> A follow-up here is built from {"{{pitch}}"}, and it waits
                  rather than sending until an offer is approved. Approving one is all it takes.
                </p>
              </div>
            ) : (
              <p className="small muted">No approved offer. None of this campaign&rsquo;s messages use one.</p>
            )}
          </div>
        </div>
        <p>
          <Link className="btn secondary small" href="/app/pitch">
            Open the Pitch page
          </Link>
        </p>
      </Section>

      <Section
        id="notes"
        title="Connection notes"
        description="Every invitation carries a note written from that person’s own headline, title and company. Read and edit each one on People."
      >
        <div className="card">
          <p>
            <strong className="nums">
              {personal} of {rows.length}
            </strong>{" "}
            <span className="small muted">{rows.length === 1 ? "note is" : "notes are"} written for the person.</span>
          </p>
          {onTemplate > 0 ? (
            <div className="notice">
              <strong>
                {onTemplate} of {rows.length} {onTemplate === 1 ? "person is" : "people are"} getting
                the campaign&rsquo;s generic note.
              </strong>
              <p className="small">
                The writer came back without a note for {onTemplate === 1 ? "this person" : "these people"}, so
                they fall back to the template with their first name filled in, which works and reads like
                everyone else&rsquo;s. Each one is marked on People. You can write {onTemplate === 1 ? "it" : "them"}{" "}
                yourself before launching, or launch as it is.
              </p>
            </div>
          ) : null}
          <p className="small">
            <Link href={sectionHref(campaign.id, "people")}>Read every note on People</Link>
          </p>
        </div>

        {/*
          The way back to the copy. Without it the agent is a settings page
          that changes nothing for anybody who already has a campaign: the
          openers are fixed, the notes stay as they were written, and the only
          other route is editing every one of them by hand.
        */}
        <form action={rewriteNotes} className="card action-card">
          <div className="action-card-text">
            <p>
              <strong>Rewrite the notes</strong>
            </p>
            <p className="small muted">
              Nora writes a new note for everybody not invited yet, using your agent&rsquo;s openers as
              they are now. People already invited keep the note they were sent.
            </p>
          </div>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <SubmitButton className="btn secondary" pendingLabel="Writing…">
            Rewrite notes
          </SubmitButton>
        </form>
      </Section>

      {variantStandings.length > 0 ? (
        <Section
          id="angles"
          title="Angles being tested"
          action={
            <p className="tiny subtle">
              {readyToCompare
                ? "Enough sent to compare."
                : `Too early to compare. Each angle needs ${MIN_SENDS_TO_COMPARE} invitations.`}
            </p>
          }
        >
          {/*
            The variable under test is the angle, not the words. Every prospect
            already receives a note written from their own headline and company,
            so a test of literal text would be comparing one-off sentences.
          */}
          <div className="table-scroll card-rows">
            <table>
              <thead>
                <tr>
                  <th>Angle</th>
                  <th>Pain it names</th>
                  <th className="num">Sent</th>
                  <th className="num">Accepted</th>
                  <th className="num">Replied</th>
                </tr>
              </thead>
              <tbody>
                {variantStandings.map((standing) => {
                  const variant = variantRows.find((v) => v.id === standing.id);
                  // An angle owns its prospect end to end (rule 28), offer
                  // included, so its own lines are named beside it.
                  const ownHook = variant?.hook_id ? hooks.find((h) => h.id === variant.hook_id) : null;
                  const ownPitch = variant?.pitch_id ? pitches.find((p) => p.id === variant.pitch_id) : null;
                  return (
                    <tr key={standing.id}>
                      <td data-label="Angle">
                        <strong>{standing.name}</strong>
                        {!variant?.enabled ? (
                          <>
                            {" "}
                            <span className="pill">retired</span>
                          </>
                        ) : null}
                        <span className="tiny subtle block">{variant?.angle}</span>
                        {ownHook || ownPitch ? (
                          <span className="tiny subtle block">
                            {ownHook ? `Opener: ${ownHook.name}${ownHook.approved_at ? "" : " (not approved yet)"}` : ""}
                            {ownHook && ownPitch ? " · " : ""}
                            {ownPitch ? `Offer: ${ownPitch.name}${ownPitch.approved_at ? "" : " (not approved, so the default goes)"}` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td data-label="Pain it names" className="small muted">{variant?.pain_point ?? "Not named"}</td>
                      <td data-label="Sent" className="num">{standing.sent}</td>
                      <td data-label="Accepted" className="num">
                        {standing.accepted}
                        {/*
                          The rate is only shown once there is enough behind it
                          to mean anything. Three acceptances from four
                          invitations reads as 75% and is worth almost nothing —
                          and a rep who kills the better angle on that has lost
                          more than the test could ever have won.
                        */}
                        {standing.sent >= MIN_SENDS_TO_COMPARE && standing.acceptanceRate !== null ? (
                          <span className="tiny subtle block">
                            {Math.round(standing.acceptanceRate * 100)}% ({Math.round(standing.low * 100)}
                            {" to "}
                            {Math.round(standing.high * 100)}%)
                          </span>
                        ) : (
                          <span className="tiny subtle block">
                            {standing.sent === 0 ? "not sent yet" : "too few to rate"}
                          </span>
                        )}
                      </td>
                      <td data-label="Replied" className="num">{standing.replied}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="tiny subtle">
            {readyToCompare && variantStandings.some((standing) => !standing.leading)
              ? "The ranges are the spread the true rate plausibly sits in. An angle is only called behind when its whole range sits below another's."
              : "Every angle here is still level: none of their ranges separate yet, which is the correct reading of a test this young."}
          </p>
        </Section>
      ) : null}
    </>
  );
}
