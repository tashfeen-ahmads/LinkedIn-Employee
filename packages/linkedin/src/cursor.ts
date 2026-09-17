/**
 * Where a classic search had got to.
 *
 * Sales Navigator takes the whole customer profile as one query and hands back
 * one cursor, so continuing it is the provider's problem. Classic search has a
 * single keyword box, so a profile naming six titles is asked as six separate
 * searches and the answers merged — and six searches are at six different
 * places. One provider cursor cannot describe that, and the classic path used
 * to admit as much by returning `cursor: null` every time: every run started at
 * the first page, found the same fifty people, and the deduplication that
 * exists to stop a prospect being contacted twice reported them all as already
 * known. "Find more" would have been a button that could only ever find the
 * same ones.
 *
 * So the position of every term travels together, as one opaque string the rest
 * of the product stores and hands back without reading.
 */
export interface ClassicPosition {
  /**
   * Which pass: 0 searches inside the profile's industries, 1 is the fallback
   * that drops them. They are different searches over different people, so a
   * run that exhausts the first has somewhere to go rather than starting over.
   */
  round: number;
  /**
   * The terms that still have pages left, each holding the provider cursor that
   * returns the next one.
   *
   * An empty string means the term has not been asked yet and starts at the
   * beginning — which is what a term the last run had no room left to reach
   * needs, and is not the same as a term that is finished. A finished term is
   * absent, and when every term is absent the pass is over.
   */
  terms: Record<string, string>;
}

/**
 * Marks a cursor as ours.
 *
 * Both tiers return a cursor through the same field, and an account that gains
 * a Sales Navigator seat between two runs would otherwise hand a classic
 * position to a Sales Navigator search — which the provider would reject, or
 * worse, quietly read as a position in some other result set.
 */
const PREFIX = "classic:";

export function isClassicCursor(cursor: string | null | undefined): boolean {
  return typeof cursor === "string" && cursor.startsWith(PREFIX);
}

export function encodeClassicCursor(position: ClassicPosition | null): string | null {
  if (!position) return null;
  return PREFIX + Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

/**
 * Reads a cursor back, or returns null for anything it does not recognise.
 *
 * A cursor arrives from a database column written by an older build, or from
 * the other tier. Refusing to read it starts the search from the beginning,
 * which costs a page of results that deduplication then discards — the safe
 * end of a bad decode. Trusting it would resume somebody else's search.
 */
export function decodeClassicCursor(cursor: string | null | undefined): ClassicPosition | null {
  if (!isClassicCursor(cursor)) return null;
  try {
    const raw: unknown = JSON.parse(
      Buffer.from((cursor as string).slice(PREFIX.length), "base64url").toString("utf8"),
    );
    if (!raw || typeof raw !== "object") return null;
    const { round, terms } = raw as { round?: unknown; terms?: unknown };
    if (typeof round !== "number" || !Number.isInteger(round) || round < 0) return null;
    if (!terms || typeof terms !== "object") return null;
    const clean: Record<string, string> = {};
    for (const [term, at] of Object.entries(terms as Record<string, unknown>)) {
      if (typeof at !== "string") return null;
      clean[term] = at;
    }
    return { round, terms: clean };
  } catch {
    return null;
  }
}
