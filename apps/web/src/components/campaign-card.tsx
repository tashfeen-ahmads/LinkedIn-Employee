import Link from "next/link";
import { stagesFor, type CtaKind, type FunnelCounts } from "@le/shared";
import { SubmitButton } from "@/components/submit-button";
import { label } from "@/lib/labels";

/**
 * One campaign on the campaigns list, as a card a person can read at a glance.
 *
 * The list was a column of rows each carrying its connection note: the one
 * fact a person scanning their campaigns does not need, and none of the ones
 * they do — is it sending, how far through the list is it, is anybody
 * answering, does it want me. Those are the card now, in that order.
 *
 * The tiles follow the campaign's goal (rule 29, `stagesFor`): a campaign that
 * is not asking for a meeting has no Booked tile, because a permanent zero
 * there reports a working campaign as a failing one.
 *
 * The action is the one thing a person does to a campaign from here. Pause and
 * Resume are presses; a draft opens instead, because launching is the one
 * action that reaches strangers and it happens after the list and the copy
 * have been read, never from a card that shows neither.
 */
export interface CampaignCardData {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  strategy: string | null;
  goal: CtaKind;
  people: number;
  waiting: number;
  counts: FunnelCounts;
  /** One line on what this campaign needs from the person, if anything. */
  needs: { text: string; tone: "attention" | "quiet" };
}

export function CampaignCard({
  campaign,
  statusAction,
}: {
  campaign: CampaignCardData;
  /** Kept for callers; the card no longer prints a date. */
  timezone?: string | null;
  /** The campaign's own pause and launch action, so this card never has a second way to do either. */
  statusAction: (formData: FormData) => Promise<void>;
}) {
  const { counts } = campaign;
  const invited = counts.invited;
  const share = campaign.people > 0 ? Math.min(1, invited / campaign.people) : 0;
  const booked = stagesFor(campaign.goal).some((stage) => stage.key === "meetings");
  const href = `/app/campaigns/${campaign.id}`;
  const tone = campaign.status === "running" ? "positive" : campaign.status === "paused" ? "warning" : "";

  // Three tiles on every card, so cards side by side line up: the third is
  // Booked for a campaign asking for a meeting and Interested otherwise
  // (rule 29: a permanent zero under Booked reports a working link campaign
  // as a failing one).
  const tiles: Array<{ label: string; value: number }> = [
    { label: "Accepted", value: counts.accepted },
    { label: "Replied", value: counts.replied },
    booked ? { label: "Booked", value: counts.meetings } : { label: "Interested", value: counts.positive },
  ];

  return (
    <article className="campaign-card">
      <div className="campaign-card-body">
        <div className="campaign-card-head">
          <h3 className="campaign-card-title">
            <Link href={href} title={campaign.name}>
              {campaign.name}
            </Link>
          </h3>
          <span className={`pill ${tone}`}>{label(campaign.status)}</span>
        </div>
        <p className="small muted campaign-card-via" title={campaign.strategy ?? undefined}>
          {campaign.strategy ? `For ${campaign.strategy}` : "From your prospect list"}
        </p>

        <dl className="campaign-card-tiles">
          {tiles.map((tile) => (
            <div key={tile.label}>
              <dt>{tile.label}</dt>
              <dd className="nums">{tile.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>

        <div className="campaign-card-progress">
          <div
            className="campaign-card-track"
            role="meter"
            aria-valuenow={invited}
            aria-valuemin={0}
            aria-valuemax={Math.max(1, campaign.people)}
            aria-label={`${invited} of ${campaign.people} invited`}
          >
            <span className="campaign-card-fill" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="small muted nums">
            {invited.toLocaleString()} of {campaign.people.toLocaleString()} {campaign.people === 1 ? "person" : "people"} invited
            {campaign.waiting > 0 ? ` · ${campaign.waiting.toLocaleString()} still to go` : ""}
          </p>
        </div>

        <p className={`small campaign-card-needs${campaign.needs.tone === "attention" ? " is-attention" : ""}`}>
          <span className="campaign-card-dot" aria-hidden="true" />
          {campaign.needs.text}
        </p>
      </div>

      {/*
        One obvious action and, at most, one quiet one. Pause sat in a
        full-width outlined button with an arrow beside it, so the most
        common thing to do with a running campaign (look at it) was the
        smaller control, and stopping it was the bigger one.
      */}
      <div className="campaign-card-foot">
        {campaign.status === "draft" ? (
          <Link className="btn campaign-card-main" href={href}>
            Review and launch
          </Link>
        ) : campaign.status === "paused" ? (
          <>
            <form action={statusAction} className="campaign-card-main">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="status" value="running" />
              <SubmitButton className="btn block" pendingLabel="Resuming…">
                Resume
              </SubmitButton>
            </form>
            <Link className="btn ghost campaign-card-side" href={href}>
              Open
            </Link>
          </>
        ) : (
          <>
            <Link className="btn secondary campaign-card-main" href={href}>
              Open campaign
            </Link>
            {campaign.status === "running" ? (
              <form action={statusAction} className="campaign-card-side">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <input type="hidden" name="status" value="paused" />
                <input type="hidden" name="back" value="list" />
                <SubmitButton className="btn ghost" pendingLabel="Pausing…">
                  Pause
                </SubmitButton>
              </form>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
