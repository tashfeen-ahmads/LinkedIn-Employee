"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type NavLink = { href: string; label: string; also?: ReadonlyArray<string> };

/**
 * Where a link stands relative to the page being read.
 *
 * `page` is the link's own page. `true` is a page inside its part of the site:
 * a guide under Guides, or /security under Safety, which the footer and the
 * limits page both treat as one subject. Marked, so the nav still says where
 * somebody is, but not as `page`, because that would tell a screen reader they
 * are on a page they are not.
 */
function currentFor(link: NavLink, pathname: string | null): "page" | "true" | undefined {
  if (!pathname) return undefined;
  if (pathname === link.href) return "page";
  const within = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (link.href !== "/" && within(link.href)) return "true";
  if (link.also?.some(within)) return "true";
  return undefined;
}

/**
 * The marketing nav, which has to know where you are.
 *
 * Five links of one weight tell a visitor nothing about which page they are
 * standing on, the application's sidebar has marked its current row since the
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
          aria-current={currentFor(link, pathname)}
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
 * Below 900px the inline nav is hidden and below 480px so is Sign in, and for
 * a while nothing replaced either: a phone visitor could reach Sign up and the
 * home page and nothing else, and somebody with an account had no way in from
 * the site at all. So the menu carries Sign in too, whatever the header has
 * room for.
 *
 * A `<details>` rather than a scripted drawer: the summary is a real button to
 * the keyboard and to a screen reader, it announces expanded and collapsed by
 * itself, and it opens without any of this file's JavaScript having run. The
 * script only closes it again, on navigation, on Escape, and on a click
 * outside, because a menu left open over the page you just chose reads as
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
            aria-current={currentFor(link, pathname)}
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
