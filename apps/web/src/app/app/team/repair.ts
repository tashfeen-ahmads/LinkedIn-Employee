import type { WorkerResult } from "@/lib/worker";

export interface RefreshResult {
  found?: number;
  mine?: number;
  bound?: number;
  changed?: boolean;
  lost?: boolean;
  unlabelled?: boolean;
  referenceShape?: string[];
  /** The shape this rep's own id has, so "found" can be compared to "wanted". */
  expected?: string;
  /**
   * The keys the provider actually sent for the first account, with the shape
   * of each value. Diagnostic: when nothing matches, the reading of the payload
   * is the thing most likely to be wrong, and this is the payload.
   */
  fields?: Array<Record<string, string>> | null;
}

export interface RepairNotice {
  tone: "accent" | "danger";
  title: string;
  body: string;
  fix?: string;
}

/**
 * What asking the provider just told us, in words the rep can act on.
 *
 * The case worth naming properly is the last one. A LinkedIn account connected
 * from inside the provider's own dashboard carries no reference to anybody
 * here, so no workspace can claim it — and from the provider's side it looks
 * perfectly healthy, which is exactly the contradiction that costs a day. It
 * cannot be attached automatically: an account labelled with nobody could
 * belong to anybody, and binding it to whoever happens to ask is how one
 * company's campaign goes out from another company's LinkedIn.
 */
export function describeRepair(result: WorkerResult<RefreshResult>): RepairNotice | null {
  if (!result.ok) {
    return {
      tone: "danger",
      title: "We couldn't check your LinkedIn connection just now.",
      body: result.error,
    };
  }

  const data = result.data;
  if (data?.changed) {
    return {
      tone: "accent",
      title: "Reconnected.",
      body: "Your LinkedIn account is attached again and ready.",
    };
  }
  if (data?.bound) {
    return { tone: "accent", title: "Connected.", body: "Your LinkedIn account is attached and ready." };
  }

  // The account this row holds is in the provider's list, it simply is not
  // labelled with this rep. Nothing is broken and nothing needs pressing — an
  // account attached by an administrator, or connected before labelling
  // existed, lives here permanently and legitimately.
  if (data?.unlabelled) return null;

  const found = data?.found ?? 0;
  if (found > 0 && (data?.mine ?? 0) === 0) {
    // Said in words the rep can act on. How many accounts we hold and how
    // they are labelled is ours to know (rule 54): it read to a customer as
    // "the product is broken", and the fix is the same either way.
    return {
      tone: "danger",
      title: "We couldn't find your LinkedIn sign-in yet.",
      body: "If you signed in a moment ago it can take a minute to show up here.",
      fix: "Press Connect LinkedIn below and finish signing in on LinkedIn's page.",
    };
  }
  if (data?.lost || found === 0) {
    return {
      tone: "danger",
      title: "Your LinkedIn account isn't connected.",
      body: "The connection we had for you is no longer working.",
      fix: "Press Connect LinkedIn below.",
    };
  }
  return null;
}

/**
 * Can this account actually send?
 *
 * The question the Team page has to answer before it decides whether to show
 * usage bars or a way back in. It was answered inline and wrongly: the page
 * cleared its connected state only for `connecting`, so a `reauth_required`
 * row rendered the connected card — bars, Sales Navigator, working hours — and
 * the branch holding Connect LinkedIn never ran. The banner elsewhere in the
 * app said "Reconnect" and linked here, and here had nothing to press.
 *
 * `warning` and `restricted` are deliberately not failures here. Those are
 * LinkedIn pausing an account that is still properly connected: signing in
 * again does not lift a restriction, and telling someone to do it is advice
 * that costs them a sign-in and changes nothing.
 */
export function cannotSend(status: string | null | undefined): boolean {
  if (!status) return false;
  return !["active", "warning", "restricted"].includes(status);
}
