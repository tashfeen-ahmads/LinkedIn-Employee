import "server-only";

/**
 * Paging past PostgREST's silent row cap.
 *
 * The helper itself lives in `@le/db` — the cap is a fact about PostgREST, not
 * about the web tier, and the worker's GDPR export hit it too. This re-export
 * keeps the import path the pages already use.
 */
export { PAGE_SIZE, MAX_PAGES, fetchAllRows, type PagedResult } from "@le/db";
