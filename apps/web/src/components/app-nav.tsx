"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  /** Rendered as a count badge; omitted when zero so an empty inbox is quiet. */
  count?: number;
  /**
   * What this section needs from the person, if anything.
   *
   * `next` marks the single step this workspace is actually on; `attention`
   * marks something broken. At most one of each, or the marking means
   * nothing — a sidebar where six things are urgent has no urgent things.
   */
  state?: "next" | "attention";
  /** Said out loud for a screen reader, which cannot see a coloured dot. */
  stateLabel?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /**
   * A group that opens on arrival however the last visit left it.
   *
   * The daily loop is not somewhere a rep should have to click to reach, and a
   * remembered collapse that hides the Inbox is a rep who stops opening the
   * Inbox.
   */
  alwaysOpen?: boolean;
}

const STORAGE_KEY = "le.nav.collapsed";

/**
 * The sidebar.
 *
 * Twelve equally-weighted links is a list you read, not a navigation you use —
 * so the groups are real, their headings are the strongest thing in the
 * sidebar, and each one collapses. That is the pattern every dense tool has
 * converged on (HubSpot, GoHighLevel, Linear): the sections are the map, and a
 * rep working the inbox all day can fold away the six links they touch once a
 * month without losing them.
 *
 * What is collapsed is remembered per browser, in `localStorage` — a
 * convenience for the person at this screen, never state the product reads
 * back. Every read and write is wrapped, because that accessor throws in a
 * private window and a sidebar that fails to render is worse than a sidebar
 * that forgets.
 *
 * A group containing the current page is never collapsed, whatever was
 * remembered: hiding the link you are standing on leaves the nav claiming you
 * are nowhere.
 */
export function AppNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  // Read after mount, never during render: the server has no localStorage, and
  // a first paint that disagrees with it is a hydration mismatch.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setCollapsed(JSON.parse(saved) as string[]);
    } catch {
      // Private window, blocked storage, or something that is not JSON. The
      // sidebar opens fully, which is the right answer when we cannot know.
    }
  }, []);

  const toggle = (label: string) => {
    setCollapsed((current) => {
      const next = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Not remembered. The toggle still works for this visit.
      }
      return next;
    });
  };

  /*
   * Filtering, not a search index.
   *
   * There are about twenty destinations in this product, and the thing a
   * person actually wants is to type "pitch" and land on it rather than
   * remember which of five headings it sits under. Matching the group's name
   * too means "settings" finds everything under Settings, which is how
   * somebody who does not yet know the vocabulary looks for a thing.
   */
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? groups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              item.label.toLowerCase().includes(needle) ||
              group.label.toLowerCase().includes(needle),
          ),
        }))
        .filter((group) => group.items.length > 0)
    : groups;

  return (
    <nav className="nav" aria-label="Sections">
      <div className="nav-search">
        <label className="sr-only" htmlFor="nav-search">
          Search the menu
        </label>
        <input
          id="nav-search"
          type="search"
          value={query}
          placeholder="Search…"
          onChange={(event) => setQuery(event.target.value)}
          // Escape clears rather than blurs: the nav is a place you pass
          // through, and leaving a stale filter behind hides most of it.
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
      </div>

      {needle && shown.length === 0 ? (
        <p className="small muted nav-empty">Nothing matches “{query.trim()}”.</p>
      ) : null}

      {shown.map((group) => {
        const holdsCurrentPage = group.items.some((item) => isCurrent(pathname, item.href));
        const wants = group.items.some((item) => item.state);
        const open =
          // A filtered group is always open: finding a match and then hiding
          // it behind a fold somebody collapsed last week is worse than no
          // search at all.
          Boolean(needle) ||
          group.alwaysOpen ||
          holdsCurrentPage ||
          wants ||
          !collapsed.includes(group.label);
        // A group folded away still has to report what is waiting inside it,
        // or collapsing the sidebar is how somebody stops seeing their inbox.
        const hidden = group.items.reduce((sum, item) => sum + (item.count ?? 0), 0);

        return (
          <div className="nav-group" key={group.label}>
            {group.alwaysOpen ? (
              <p className="nav-group-label">{group.label}</p>
            ) : (
              <button
                type="button"
                className="nav-group-toggle"
                aria-expanded={open}
                onClick={() => toggle(group.label)}
              >
                <span className="nav-group-label">{group.label}</span>
                {!open && hidden > 0 ? <span className="nav-count">{hidden}</span> : null}
                <Chevron open={open} />
              </button>
            )}

            {open ? (
              <div className="nav-items">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  >
                    <span>{item.label}</span>
                    {item.state ? (
                      <span className={`nav-dot ${item.state}`} aria-hidden="true" />
                    ) : null}
                    {item.state ? (
                      <span className="sr-only">{item.stateLabel ?? item.state}</span>
                    ) : null}
                    {item.count ? <span className="nav-count">{item.count}</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

/** Rotates rather than swapping glyphs, so the state reads as one control. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`nav-chevron ${open ? "is-open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 2.5L7.5 6L4 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * `/app` is every page's prefix, so a prefix test alone marks the whole nav as
 * current. It matches exactly; everything else also matches its own subpages,
 * so a campaign's detail page keeps Campaigns lit.
 */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
