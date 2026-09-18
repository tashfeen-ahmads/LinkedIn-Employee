/**
 * PostgREST answers at most `db-max-rows` rows — 1000 by default — and says so
 * nowhere in the payload. A select that hits the cap returns a shorter array
 * and no error, to the service role exactly as to anybody else: it is a
 * PostgREST setting, not a row-level policy.
 *
 * That makes it invisible in precisely the places it matters most. Every funnel
 * in this product counts rows in the application tier, and the GDPR export
 * hands somebody a file described as everything held about them. `Find more`
 * exists to grow a campaign past a thousand (rule 20) and rule 24 keeps every
 * prospect row for ever, so a workspace crosses the cap within weeks and
 * nothing announces the day it did.
 *
 * Counting or exporting in SQL instead would be faster and would put a second
 * definition of each of those things in the database, where it would drift from
 * the one in this repo — the failure this codebase keeps finding. So the rows
 * are fetched in pages and the one definition keeps working on them.
 */
export const PAGE_SIZE = 1000;

/** A safety stop, so a bad filter cannot walk a table for ever. */
export const MAX_PAGES = 50;

export interface PagedResult<T> {
  rows: T[];
  /**
   * True when the walk stopped at `MAX_PAGES` with more still to come. Every
   * caller has to say so rather than present a partial answer as the whole one
   * — which is exactly what the raw cap did.
   */
  truncated: boolean;
}

/**
 * Walks a PostgREST query to the end.
 *
 * `query(from, to)` must apply `.range(from, to)` to an otherwise complete,
 * **ordered** query. Without a stable order two pages can overlap or skip: the
 * server is free to return rows in any order, and "any order" is not the same
 * one twice.
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<PagedResult<T>> {
  const rows: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    // A short page is the end. A full one might be, and costs one more request
    // to find out — cheaper than being wrong about the total.
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }

  return { rows, truncated: true };
}
