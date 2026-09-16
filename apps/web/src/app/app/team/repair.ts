import type { WorkerResult } from "@/lib/worker";

export interface RefreshResult {
  found?: number;
  mine?: number;
  bound?: number;
  changed?: boolean;
  lost?: boolean;
  referenceShape?: string[];
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
      title: "Could not check with LinkedIn's provider.",
      body: result.error,
    };
  }

  const data = result.data;
  if (data?.changed) {
    return {
      tone: "accent",
      title: "Reconnected.",
      body: "The provider had a different account for you, and this is now pointed at it.",
    };
  }
  if (data?.bound) {
    return { tone: "accent", title: "Connected.", body: "Your LinkedIn account is attached and ready." };
  }

  const found = data?.found ?? 0;
  if (found > 0 && (data?.mine ?? 0) === 0) {
    return {
      tone: "danger",
      title: `LinkedIn's provider holds ${found} account${found === 1 ? "" : "s"}, and none of them is labelled as yours.`,
      body:
        "That is what a connection made inside the provider's own dashboard looks like from here: it works perfectly on their side and belongs to nobody on ours. We cannot attach an unlabelled account to you — an account labelled with nobody could belong to anybody.",
      fix: "Press Connect LinkedIn below and sign in through this flow once. It attaches your name to the account, and you can delete the stray one in the provider afterwards.",
    };
  }
  if (data?.lost || found === 0) {
    return {
      tone: "danger",
      title: "LinkedIn's provider has no account for you.",
      body: "Whatever was connected before is gone from their side.",
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
