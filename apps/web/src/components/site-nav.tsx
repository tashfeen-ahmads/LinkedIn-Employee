"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

type NavLink = { href: string; label: string };

/**
 * The marketing nav, which has to know where you are.
 *
 * Five links of one weight tell a visitor nothing about which page they are
 * standing on — the application's sidebar has marked its current row since the
 * first week and the public site never did. Knowing the path means reading it
 * in the browser, so this one piece is a client component rather than making
 * the whole header one.
 */
export function SiteNav({ links }: { links: ReadonlyArray<NavLink> }) {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Main">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="site-nav-link"
          aria-current={pathname === link.href ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The same links, behind a Menu button, for the widths where the bar has no
 * room for them.
 *
 * Below 900px the inline nav is hidden and below 640px so is Sign in, and for
 * a while nothing replaced either: a phone visitor could reach Sign up and the
 * home page and nothing else, and somebody with an account had no way in from
 * the site at all. So the menu carries Sign in too, whatever the header has
 * room for.
 *
 * A `<details>` rather than a scripted drawer: the summary is a real button to
 * the keyboard and to a screen reader, it announces expanded and collapsed by
 * itself, and it opens without any of this file's JavaScript having run. The
 * script only closes it again — on navigation, on Escape, and on a click
 * outside — because a menu left open over the page you just chose reads as
 * the click not having worked.
 */
export function SiteMenu({ links, signInHref }: { links: ReadonlyArray<NavLink>; signInHref: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <details className="site-menu" ref={ref}>
      <summary className="btn secondary small site-menu-toggle">Menu</summary>
      <nav className="site-menu-panel" aria-label="Main">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="site-menu-link"
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
        <Link href={signInHref} className="site-menu-link">
          Sign in
        </Link>
      </nav>
    </details>
  );
}

/**
 * Renders its children everywhere except on the page they would link to.
 *
 * The closing band sits in the marketing layout, which cannot see the path,
 * and its "See how it works" button on /how-it-works was a link to the page
 * already open. Asking here keeps the layout a server component.
 */
export function UnlessOn({ path, children }: { path: string; children: ReactNode }) {
  const pathname = usePathname();
  return pathname === path ? null : <>{children}</>;
}
