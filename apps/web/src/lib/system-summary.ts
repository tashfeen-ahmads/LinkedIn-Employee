/**
 * The one sentence at the top of the system check.
 *
 * It said "Nothing is blocked. Every stage from onboarding to replies has what
 * it needs" whenever no row was blocked and none was the customer's move, which
 * included a check that came back with no rows at all and one where half the
 * stages could not look yet. Rule 17: a stage that was skipped reports
 * `waiting`, never `ok`, and a summary that rounds `waiting` up to "has what it
 * needs" is that same disease one line higher, on the line people read.
 */
export type SummaryState = "ok" | "blocked" | "waiting" | "unknown" | "todo";

export type SystemSummary =
  | { kind: "blocked" | "todo"; index: number }
  | { kind: "clear" }
  | { kind: "unconfirmed"; count: number }
  | { kind: "empty" };

export function systemSummary(checks: ReadonlyArray<{ state: SummaryState | string }>): SystemSummary {
  if (checks.length === 0) return { kind: "empty" };
  const blocked = checks.findIndex((c) => c.state === "blocked");
  if (blocked !== -1) return { kind: "blocked", index: blocked };
  const todo = checks.findIndex((c) => c.state === "todo");
  if (todo !== -1) return { kind: "todo", index: todo };
  const unconfirmed = checks.filter((c) => c.state !== "ok").length;
  return unconfirmed > 0 ? { kind: "unconfirmed", count: unconfirmed } : { kind: "clear" };
}
