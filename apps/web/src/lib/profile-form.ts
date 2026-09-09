import { CustomerProfileSchema, SalesNavFiltersSchema, type CustomerProfile } from "@le/shared";

/**
 * Turning a Sales Navigator filter set into something a person can edit in a
 * browser, and back again.
 *
 * These are the fields that decide who the Targeting Agent searches for, so a
 * malformed edit must fail loudly rather than write a half-parsed filter that
 * quietly matches everybody.
 */

/** One value per line, so commas inside a title ("VP, Operations") survive. */
export function parseList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatList(values: readonly string[]): string {
  return values.join("\n");
}

export const FILTER_FIELDS = [
  { key: "titles", label: "Job titles" },
  { key: "seniorities", label: "Seniority" },
  { key: "industries", label: "Industries" },
  { key: "companyHeadcount", label: "Company size" },
  { key: "geographies", label: "Locations" },
  { key: "keywords", label: "Keywords" },
  { key: "excludeTitles", label: "Exclude titles" },
] as const satisfies ReadonlyArray<{ key: keyof typeof SalesNavFiltersSchema.shape; label: string }>;

export interface ProfileEdits {
  priority: number;
  filters: Record<(typeof FILTER_FIELDS)[number]["key"], string>;
}

export type EditResult =
  | { ok: true; spec: CustomerProfile }
  | { ok: false; error: string };

/**
 * Merges an edit into the stored profile and re-validates the whole thing. The
 * spec is written back only if it still satisfies the same schema the agent's
 * output had to satisfy — one definition of a valid profile, whoever wrote it.
 */
export function applyProfileEdits(currentSpec: unknown, edits: ProfileEdits): EditResult {
  const parsed = CustomerProfileSchema.safeParse(currentSpec);
  if (!parsed.success) {
    return { ok: false, error: "This profile is not readable; regenerate it rather than editing." };
  }

  const filters = { ...parsed.data.salesNavFilters };
  for (const field of FILTER_FIELDS) {
    filters[field.key] = parseList(edits.filters[field.key] ?? "");
  }

  // A search with no titles, no seniority, no industry and no keywords returns
  // whoever LinkedIn feels like returning. That is not a target market.
  if (
    filters.titles.length === 0 &&
    filters.seniorities.length === 0 &&
    filters.industries.length === 0 &&
    filters.keywords.length === 0
  ) {
    return {
      ok: false,
      error: "Give the search something to match on: a title, a seniority, an industry or a keyword.",
    };
  }

  const next = CustomerProfileSchema.safeParse({
    ...parsed.data,
    salesNavFilters: filters,
    priority: edits.priority,
  });
  if (!next.success) {
    return { ok: false, error: next.error.issues[0]?.message ?? "That edit is not valid." };
  }

  return { ok: true, spec: next.data };
}
