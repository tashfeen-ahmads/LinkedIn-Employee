"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The marketing nav, which has to know where you are.
 *
 * Five links of one weight tell a visitor nothing about which page they are
 * standing on — the application's sidebar has marked its current row since the
 * first week and the public site never did. Knowing the path means reading it
 * in the browser, so this one piece is a client component rather than making
 * the whole header one.
 */
export function SiteNav({ links }: { links: ReadonlyArray<{ href: string; label: string }> }) {
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
