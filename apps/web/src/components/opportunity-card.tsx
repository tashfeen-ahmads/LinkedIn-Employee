import Link from "next/link";
import { formatDateTime, formatWhen, isoAttr } from "@/lib/format";

export interface OpportunityCardData {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  campaignId: string | null;
  campaignName: string | null;
  lastMessageAt: string | null;
  /** The conversation is held for a person in the inbox. */
  waitingOnYou: boolean;
  inboxHref: string;
}

/**
 * One conversation on the opportunities board.
 *
 * The name is the link, and it opens the inbox, because that is where the
 * conversation is answered: the board is the map, the inbox is the work.
 * "Waiting on you" is said in words as well as colour, since the dot alone
 * means nothing to a screen reader and little to anybody who has not been
 * told what amber is for.
 */
export function OpportunityCard({ card, timezone }: { card: OpportunityCardData; timezone: string | null }) {
  const role = [card.title, card.company].filter(Boolean).join(" · ");
  return (
    <article className="opp-card">
      <div className="opp-card-top">
        <Link className="opp-card-name" href={card.inboxHref}>
          {card.name}
        </Link>
        {card.waitingOnYou ? <span className="pill warning">Waiting on you</span> : null}
      </div>
      {role ? <p className="opp-card-role small muted">{role}</p> : null}
      <p className="opp-card-meta tiny subtle">
        {card.campaignId && card.campaignName ? (
          <Link href={`/app/campaigns/${card.campaignId}`}>{card.campaignName}</Link>
        ) : (
          "No campaign"
        )}
        {card.lastMessageAt ? (
          <>
            {" · "}
            <time dateTime={isoAttr(card.lastMessageAt)} title={formatDateTime(card.lastMessageAt, timezone)}>
              {formatWhen(card.lastMessageAt, timezone)}
            </time>
          </>
        ) : null}
      </p>
    </article>
  );
}
