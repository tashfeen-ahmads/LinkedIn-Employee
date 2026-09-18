import type { NavItem } from "@/components/app-nav";

export interface NavMarks {
  /** The one step this workspace is on, from `nextStep`. Null when set up. */
  nextHref: string | null;
  /** LinkedIn is not connected, so nothing this product does reaches anybody. */
  linkedInNeedsYou: boolean;
}

/**
 * Which sidebar link, if any, carries a mark.
 *
 * The rule is that there is **one**. A sidebar where six things are urgent has
 * no urgent things, and the whole point of the dot is that somebody who has
 * never seen this product can find the single section that wants them next.
 *
 * `attention` beats `next` on the same link, and a broken LinkedIn connection
 * silences the next-step mark everywhere else: there is no next step while the
 * thing every step depends on is disconnected, and pointing at Knowledge while
 * the account cannot send is pointing at the wrong stage — the same disease as
 * a diagnostics check that reports `ok` because it could not look.
 */
export function markFor(href: string, label: string, marks: NavMarks): Pick<NavItem, "state" | "stateLabel"> {
  if (href === "/app/team" && marks.linkedInNeedsYou) {
    return { state: "attention", stateLabel: "LinkedIn is not connected" };
  }
  if (marks.linkedInNeedsYou) return {};
  if (marks.nextHref === href) {
    return { state: "next", stateLabel: `${label} — your next step` };
  }
  return {};
}
