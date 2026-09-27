import type { SVGProps } from "react";

/**
 * The navigation's glyphs.
 *
 * Twelve lines of grey text at one size is a paragraph with links in it. A
 * glyph gives every row a fixed anchor at the left edge, which is what lets
 * somebody find the Inbox without reading the word — the difference between a
 * list you read and a map you aim at.
 *
 * Drawn here rather than pulled from an icon package: fourteen paths is less
 * code than a dependency's tree-shaking configuration, and a set drawn to one
 * grid cannot drift the way a set assembled from three packages does.
 *
 * One grid, and it is the whole reason they look like a set: a 24-unit box,
 * a 2-unit stroke, round caps and joins, and `currentColor` throughout so a
 * glyph takes the colour of the row it sits in — including the accent when
 * that row is the page you are on.
 */
function Glyph({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  /* The operator console. A shield, because what it guards is other
     people's data — the console can see that a workspace exists, never
     what it says (rule 15). */
  shield: (
    <path d="M12 3l7 3v5c0 4.4-2.9 8.4-7 9.5C7.9 19.4 5 15.4 5 11V6l7-3z" />
  ),
  /* Overview — the four panels of a dashboard. */
  overview: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  /* Inbox — a tray with the slot a message drops into. */
  inbox: (
    <>
      <path d="M3 13h4l1.5 3h7L17 13h4" />
      <path d="M4.5 5.5 3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-1.5-7.5A2 2 0 0 0 17.6 4H6.4a2 2 0 0 0-1.9 1.5Z" />
    </>
  ),
  /* Campaigns — outreach going out. */
  campaigns: (
    <>
      <path d="m21.5 2.5-9 19-3-8-8-3 20-8Z" />
      <path d="m21.5 2.5-12 11" />
    </>
  ),
  /* Strategies — who to go after. */
  strategies: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  /* Agents — the thing that writes. */
  agents: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 7V4M9 13h.01M15 13h.01M9.5 16.2a4 4 0 0 0 5 0" />
    </>
  ),
  /* Calls to action — a destination. */
  cta: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2" />
    </>
  ),
  /* Do not contact — a name struck out. */
  exclusions: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  /* Profile & team. */
  profile: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.2a3.5 3.5 0 0 1 0 5.6M18 20a6.4 6.4 0 0 0-2-4.7" />
    </>
  ),
  /* Prospects — the list of people. */
  prospects: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  /* Meetings. */
  meetings: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  /* How it works. */
  tutorial: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.6v.4" />
      <path d="M12 17.2h.01" />
    </>
  ),
  /* System check. */
  system: (
    <>
      <path d="M3 13h3.5l2-5 3 10 2.5-7 1.5 2H21" />
    </>
  ),
  /* Support. */
  support: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.6A8.4 8.4 0 1 1 21 11.5Z" />
    </>
  ),
  /* Billing. */
  billing: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6 15h4" />
    </>
  ),
  /* Knowledge. */
  knowledge: (
    <>
      <path d="M4 5.5A2 2 0 0 1 6 3.5h5v17H6a2 2 0 0 0-2 2Z" />
      <path d="M20 5.5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2Z" />
    </>
  ),
  /* Anything the map does not name. Never a blank space: a row with no glyph
     is a row whose left edge is 16px out of line with every other row. */
  /* Posts — a sheet with two lines of text and the corner turned up, because
     what this screen holds is something written rather than something sent. */
  posts: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="3.2" />,
};

/** The glyph for a nav destination, by the key the sidebar gives it. */
export function NavIcon({ name, className }: { name: string; className?: string }) {
  return <Glyph className={className}>{PATHS[name] ?? PATHS.dot}</Glyph>;
}

/** Whether this set has a glyph drawn for `name` — used by its own test. */
export function hasIcon(name: string): boolean {
  return name in PATHS;
}
