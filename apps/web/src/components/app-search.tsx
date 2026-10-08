"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The one search box, in the top bar rather than in the rail.
 *
 * It sat above the twelve nav links and filtered them, which is a menu filter
 * rather than a search — useful once you already know the product, useless on
 * the day you are looking for a person. This one goes where a rep is actually
 * looking for something: a prospect. Anything typed here lands on the prospect
 * list with the query applied, because that is the only list in the product
 * big enough to need searching.
 */
export function AppSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // On the prospect list the box shows what that list is filtered by, so the
  // search you ran is still visible after it ran — and clearing it there is
  // the same act as clearing the filter.
  const current = pathname === "/app/prospects" ? (params.get("q") ?? "") : "";
  const [query, setQuery] = useState(current);
  useEffect(() => setQuery(current), [current]);

  return (
    <form
      className="app-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const term = query.trim();
        router.push(term ? `/app/prospects?q=${encodeURIComponent(term)}` : "/app/prospects");
      }}
    >
      <label className="sr-only" htmlFor="app-search">
        Search prospects
      </label>
      <svg className="app-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
        <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        id="app-search"
        type="search"
        value={query}
        name="q"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search prospects…"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
        }}
      />
    </form>
  );
}
