import { SectionNav, type SectionNavItem } from "@/components/section-nav";

export interface StrategyNavEntry {
  id: string;
  name: string | null;
  priority: number;
  approved_at: string | null;
  do_not_pursue: boolean;
  found: number;
  campaigns: number;
}

/**
 * The strategy screen's menu: the business, each strategy, and asking for more.
 *
 * Each strategy is an item rather than a card in one long scroll, so the one
 * somebody came to approve is a click away instead of somewhere under the
 * other fourteen. Its line says the three things a person decides on: whether
 * it is approved, how many people it has found, and how many campaigns came
 * from it. A strategy waiting for approval carries the menu's mark, because
 * nothing is searched for until somebody reads it (rule 9) — but a nameless
 * one does not, since there is nothing in it to approve.
 *
 * Set-aside strategies stay listed, at the end: "we decided not to pursue
 * this market" is worth remembering, and Pursue after all is on their page.
 */
export function StrategyNav({
  strategies,
  businessHref,
  businessName,
}: {
  strategies: StrategyNavEntry[];
  /** The business profile's address, carrying `?business=` when there are several. */
  businessHref: string;
  businessName: string;
}) {
  const ordered = [
    ...strategies.filter((s) => !s.do_not_pursue),
    ...strategies.filter((s) => s.do_not_pursue),
  ];
  const items: SectionNavItem[] = [
    { href: businessHref, title: "Business profile", hint: businessName },
    ...ordered.map((s) => {
      const state = s.do_not_pursue ? "Set aside" : s.approved_at ? "Approved" : "Waiting for you";
      // One short line: whether it is approved, and what it has found. The
      // priority is the menu's own order, and campaigns are on the page.
      const found = s.found ? `${s.found.toLocaleString()} found` : s.approved_at ? "Nobody found yet" : null;
      return {
        href: `/app/strategy/${s.id}`,
        title: s.name?.trim() || "Unnamed strategy",
        hint: (
          <>
            <span className="strategy-nav-state" data-state={s.do_not_pursue ? "aside" : s.approved_at ? "approved" : "waiting"}>
              {state}
            </span>
            {found ? ` · ${found}` : null}
          </>
        ),
        attention: !s.do_not_pursue && !s.approved_at && Boolean(s.name?.trim()),
      } satisfies SectionNavItem;
    }),
    {
      href: "/app/strategy/more",
      title: "Ask Sage for more",
      hint: "More, or different ones",
    },
  ];
  // Wrapped so the menu's list is the containing block for its visually
  // hidden ", needs you": on a phone the list scrolls sideways, and a hidden
  // label positioned against the page widened the whole page to its far end.
  return (
    <div className="strategy-menu">
      <SectionNav items={items} label="Strategies" />
    </div>
  );
}
