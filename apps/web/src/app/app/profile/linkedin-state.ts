/**
 * What a LinkedIn account row means to the person it belongs to.
 *
 * The rows say `connecting` from the moment somebody presses Connect, and
 * every screen printed that word as it stood. So a rep whose LinkedIn sign-in
 * was refused — wrong password, a code they never received — came back to a
 * profile, a team table and a banner all reading "connecting", which says the
 * product is working on it. Nothing was: no account was ever made, and the only
 * thing that could change it was the rep pressing Connect again. The first
 * customer to hit it sat on a call watching "connecting" for a sign-in that had
 * failed in front of her.
 *
 * A row with no provider account behind it is **not connected**, whatever its
 * status column says, and every screen reads that from here — one reading, so
 * the banner, the table and the panel cannot disagree.
 */
export interface LinkedInRow {
  status: string;
  status_detail?: string | null;
  provider_account_id?: string | null;
}

export type LinkedInState =
  /** No row: never started. */
  | { kind: "none"; label: "not connected" }
  /** Connect was pressed and the sign-in has not come back yet. */
  | { kind: "unfinished"; label: "not connected" }
  /** The sign-in came back refused; nothing was connected. */
  | { kind: "failed"; label: "not connected"; detail: string }
  /** A real account is attached, working or not. */
  | { kind: "attached"; label: string };

/** What a sign-in that LinkedIn refused says when nothing more is known. */
export const SIGN_IN_DID_NOT_HAPPEN =
  "No sign-in happened, so no LinkedIn account is connected. Press Connect LinkedIn to try again.";

export function linkedInState(row: LinkedInRow | null | undefined): LinkedInState {
  if (!row) return { kind: "none", label: "not connected" };
  if (!row.provider_account_id) {
    if (row.status === "connecting") return { kind: "unfinished", label: "not connected" };
    return { kind: "failed", label: "not connected", detail: row.status_detail ?? SIGN_IN_DID_NOT_HAPPEN };
  }
  // A row holding an account that an older Connect press set back to
  // `connecting` still has that account; it reads as needing a reconnect, never
  // as a connection in progress.
  if (row.status === "connecting") return { kind: "attached", label: "needs reconnecting" };
  return { kind: "attached", label: row.status.replaceAll("_", " ") };
}
