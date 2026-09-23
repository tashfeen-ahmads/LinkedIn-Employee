import { parseHeadline } from "@le/shared";
import type { Db } from "@le/db";

/**
 * Fills in the company and title that were never captured.
 *
 * `prospects.company` and `prospects.title` were null for every person in this
 * deployment. The columns existed, the insert wrote them, and the only source
 * that fills them — the profile endpoint — is spent only on candidates missing
 * a public URL (rule 13), because every call comes off a seat somebody pays
 * for. Classic search returns a headline and nothing structured, so everyone
 * else arrived blank and stayed blank.
 *
 * Sending is already covered: `mergeValuesFor` falls back to the headline at
 * send time, so a message can name a company even for a row written before any
 * of this existed. What it does not cover is the screens — a Prospects list
 * with an empty Company column on every row is a product that looks like it
 * failed to collect anything.
 *
 * So it runs nightly rather than as a migration. A migration fixes the rows
 * that exist on the day it runs; this fixes the ones that arrive afterwards
 * too, which matters while any path can still write a blank.
 *
 * It only ever fills a blank — `coalesce`, never overwrite. A company the
 * provider actually confirmed outranks anything read out of free text.
 */
export async function backfillProspectFields(db: Db, limit = 500): Promise<number> {
  // Narrowed in code rather than with `.or()`: PostgREST supports it and the
  // in-memory fake used by the worker's tests deliberately does not, throwing
  // instead of returning something a real database never would. A nightly pass
  // over a few hundred rows does not need the round trip saved.
  const { data: rows } = await db
    .from("prospects")
    .select("id, headline, company, title")
    .not("headline", "is", null)
    .limit(limit);

  let filled = 0;
  for (const row of rows ?? []) {
    if (row.company?.trim() && row.title?.trim()) continue;
    const parsed = parseHeadline(row.headline);
    const company = row.company?.trim() || parsed.company;
    const title = row.title?.trim() || parsed.title;
    // Nothing to learn from this headline. Writing the row anyway would churn
    // `updated_at` on every prospect every night for ever.
    if (company === (row.company ?? null) && title === (row.title ?? null)) continue;

    await db.from("prospects").update({ company, title }).eq("id", row.id);
    filled += 1;
  }
  return filled;
}
