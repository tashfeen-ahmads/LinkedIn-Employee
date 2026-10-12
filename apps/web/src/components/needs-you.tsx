import Link from "next/link";
import { NOTHING_NEEDS_YOU, type NeedsYouItem, type NeedsYouKind } from "@le/shared";
import { NavIcon } from "./icons";

/**
 * A glyph per kind, from the sidebar's own set, so a row points at the screen
 * that fixes it by the same picture the sidebar uses for that screen.
 */
const ICON: Record<NeedsYouKind, string> = {
  loop_stalled: "system",
  linkedin_disconnected: "profile",
  webhook_refused: "inbox",
  held_reply: "inbox",
  held_booking: "meetings",
  pitch_unapproved: "posts",
  hook_unapproved: "posts",
  strategy_unapproved: "strategies",
  campaign_unlaunched: "campaigns",
  thin_notes: "posts",
  cta_missing: "cta",
};

/**
 * What needs you, as the first and largest thing on the screen.
 *
 * The overview used to open with a next-step card, a strategy panel, a
 * six-item checklist, a row of counters and a table — five sections of equal
 * weight, and the answer to "what is stopped until I do something" distributed
 * across all of them. A screen where everything is equally important tells you
 * nothing, which is rule 32's argument about the sidebar applied to the page it
 * points at.
 *
 * One row per kind, each with the single action that unblocks it, in the order
 * the work actually costs something. A blocker gets the loud treatment because
 * every row under it is a job that cannot finish.
 *
 * Zero rows is the good day and it gets a sentence, not an apology. A dashboard
 * that looks broken when everything is fine teaches people to stop opening it.
 */
export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  if (items.length === 0) {
    return (
      <section className="card needs-you-clear" aria-labelledby="needs-you-heading">
        <p className="eyebrow">Nothing waiting</p>
        <h2 id="needs-you-heading">{NOTHING_NEEDS_YOU}</h2>
      </section>
    );
  }

  /*
   * One panel, rows divided by hairlines.
   *
   * A card per row made six things look like six separate features; a list in
   * one surface reads as one queue. Each row is the sentence, what it costs if
   * nobody does it, and the one action that clears it, outlined so the list
   * does not turn into a column of primary buttons. A blocker keeps the solid
   * button and the danger glyph, because every row under it is a job that
   * cannot finish until it is done.
   */
  return (
    <section className="needs-you" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading" className="needs-you-heading">
        Needs you
        <span className="needs-you-count">
          {items.length === 1 ? "1 thing" : `${items.length} things`}
        </span>
      </h2>

      <ul className="needs-you-list">
        {items.map((item) => (
          <li key={item.kind} className={`needs-you-item ${item.tone}`}>
            <span className="needs-you-icon" aria-hidden="true">
              <NavIcon name={ICON[item.kind] ?? "dot"} />
            </span>
            <div className="needs-you-text">
              <p className="needs-you-title">{item.title}</p>
              <p className="small muted prose">{item.why}</p>
            </div>
            <Link className={`btn small${item.tone === "blocker" ? "" : " secondary"}`} href={item.href}>
              {item.action}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
