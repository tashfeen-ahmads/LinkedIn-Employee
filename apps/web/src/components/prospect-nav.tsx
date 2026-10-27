import { SectionNav } from "@/components/section-nav";

/**
 * The prospect screen's menu: the history, the people waiting for review,
 * finding new ones, and who is off-limits.
 *
 * Four questions that used to be one long list with filters on top, where
 * "who is about to be invited" and "who has asked never to be contacted" could
 * only be answered by squinting at a status column.
 */
export function ProspectNav({
  everyone,
  review,
  searchable,
  excluded,
}: {
  everyone: number;
  review: number;
  searchable: number;
  excluded: number;
}) {
  // Wrapped for the same reason as the strategy menu (`.prospect-menu ol`).
  return (
    <div className="prospect-menu">
      <SectionNav
        label="Prospects"
        items={[
          {
            href: "/app/prospects",
            title: "All people",
            count: everyone,
            hint: "Who has been found, and who has been contacted",
          },
          {
            href: "/app/prospects/review",
            title: "Waiting for review",
            count: review,
            // A list nobody has launched is a list nobody is being written to:
            // the one item here that is waiting on a person.
            attention: review > 0,
            hint: review ? "On campaigns not launched yet" : "Nobody is waiting",
          },
          {
            href: "/app/prospects/find",
            title: "Find new",
            hint: searchable
              ? `${searchable} approved ${searchable === 1 ? "strategy" : "strategies"} to search`
              : "Approve a strategy to search",
          },
          {
            href: "/app/prospects/excluded",
            title: "Excluded",
            count: excluded,
            hint: "Do not contact, and the shared list",
          },
        ]}
      />
    </div>
  );
}
