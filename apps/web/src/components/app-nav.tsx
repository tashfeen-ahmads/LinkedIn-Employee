"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** Rendered as a count badge; omitted when zero so an empty inbox is quiet. */
  count?: number;
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
