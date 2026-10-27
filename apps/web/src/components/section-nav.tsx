"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * The side menu a large screen is split into.
 *
 * A campaign, a profile, a strategy and the prospect list each used to be one
 * page scrolled from top to bottom, with every part of the thing stacked under
 * the last: whoever opened it had to find the part they came for. Each is now
 * a set of sections, one on screen at a time, listed here.
 *
 * Two shapes. `menu` is a place to go: any section, any order. `steps` is a
 * sequence (a campaign being built): each item is numbered, says whether it
 * is done, and a step after the current one cannot be opened yet, because a
 * builder that lets somebody launch before choosing a list launches nothing.
 *
 * One definition, so the four screens cannot drift into four menus.
 */
export interface SectionNavItem {
  href: string;
  title: string;
  /** One short line under the title: what is in there, or its state. */
  hint?: ReactNode;
  /** A count beside the title; omitted when zero. */
  count?: number;
  /** Something in this section needs the person. */
  attention?: boolean;
  /** For `steps`: finished, so it shows a tick and stays open. */
  done?: boolean;
  /** For `steps`: not reachable yet. */
  locked?: boolean;
}

export function SectionNav({
  items,
  label,
  variant = "menu",
  /**
   * How the active item is decided. `path` (default) matches the pathname,
   * exactly for the first item and by prefix for the rest; `param` reads a
   * query parameter, for a section that lives on one route.
   */
  match = { by: "path" },
}: {
  items: SectionNavItem[];
  label: string;
  variant?: "menu" | "steps";
  match?: { by: "path" } | { by: "param"; name: string; fallback: string };
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const listRef = useRef<HTMLOListElement>(null);

  // On a phone the menu is a row of tabs wider than the screen; the open
  // section is scrolled into view so the person can see where they are.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>("li.is-active");
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: active.offsetLeft - list.clientWidth / 2 + active.clientWidth / 2, behavior: "auto" });
  }, [pathname, params]);

  const isActive = (item: SectionNavItem, index: number): boolean => {
    if (match.by === "param") {
      const current = params.get(match.name) ?? match.fallback;
      const target = new URL(item.href, "http://x").searchParams.get(match.name) ?? match.fallback;
      return current === target;
    }
    const path = item.href.split("?")[0]!;
    return index === 0 ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <nav className={`section-nav section-nav-${variant}`} aria-label={label}>
      <ol ref={listRef}>
        {items.map((item, index) => {
          const active = isActive(item, index);
          const body = (
            <>
              {variant === "steps" ? (
                <span className="section-nav-step" aria-hidden="true">
                  {item.done && !active ? "✓" : index + 1}
                </span>
              ) : null}
              <span className="section-nav-text">
                <span className="section-nav-title">
                  <span className="section-nav-name">{item.title}</span>
                  {item.count ? <span className="section-nav-count">{item.count}</span> : null}
                  {item.attention ? <span className="section-nav-dot" aria-hidden="true" /> : null}
                </span>
                {item.hint ? <span className="section-nav-hint">{item.hint}</span> : null}
              </span>
              {item.attention ? <span className="sr-only">, needs you</span> : null}
              {variant === "steps" && item.done && !active ? <span className="sr-only">, done</span> : null}
            </>
          );
          return (
            <li key={item.href} className={active ? "is-active" : item.locked ? "is-locked" : undefined}>
              {item.locked && !active ? (
                <span className="section-nav-link" aria-disabled="true">
                  {body}
                </span>
              ) : (
                <Link
                  className="section-nav-link"
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={typeof item.hint === "string" ? `${item.title}: ${item.hint}` : item.title}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A screen with its section menu beside it: the menu on the left, the section on the right. */
export function SectionLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="section-layout">
      <aside className="section-layout-nav">{nav}</aside>
      <div className="section-layout-body">{children}</div>
    </div>
  );
}
