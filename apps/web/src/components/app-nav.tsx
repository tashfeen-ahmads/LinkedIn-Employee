"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** Rendered as a count badge; omitted when zero so an empty inbox is quiet. */
  count?: number;
  /**
   * What this section needs from the person, if anything.
   *
   * The nav is the one thing on every screen, so it is where "this is the bit
   * that needs you" belongs. Twelve identically-weighted links is a list to
   * read rather than a product to use, and somebody who has never seen it
   * cannot tell that Team is where LinkedIn gets connected and that nothing
   * sends until it is.
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
}

/**
 * The sidebar links, and the only part of the shell that has to know where you
 * are. `aria-current="page"` was styled in the stylesheet but never set by
 * anything, so the highlight existed and never appeared: twelve identical
 * links, with no way to tell which one you were looking at.
 *
 * Deciding that needs the pathname, which is a client concern, so this is the
 * one client component in the shell. Everything around it stays on the server.
 */
export function AppNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Sections">
      {groups.map((group) => (
        <div className="nav-group" key={group.label}>
          <p className="nav-group-label">{group.label}</p>
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
              {item.state ? <span className="sr-only">{item.stateLabel ?? item.state}</span> : null}
              {item.count ? <span className="nav-count">{item.count}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
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
