import Link from "next/link";
import { NOTHING_NEEDS_YOU, type NeedsYouItem } from "@le/shared";

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

  return (
    <section className="needs-you" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading" className="needs-you-heading">
        {items.length === 1 ? "One thing needs you" : `${items.length} things need you`}
      </h2>

      <ul className="needs-you-list">
        {items.map((item) => (
          <li key={item.kind} className={`needs-you-item ${item.tone}`}>
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
