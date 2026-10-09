import { ago } from "@/lib/admin";
import { label } from "@/lib/labels";

export interface AdminAccountRow {
  status: string;
  provider_account_id: string | null;
  created_at: string;
  first_action_at?: string | null;
}

/**
 * What the operator console says about one LinkedIn account.
 *
 * A row is `connecting` from the moment somebody presses Connect, and stays
 * that way if they never finish LinkedIn's sign-in page — closed the tab, could
 * not get past a verification code. The provider then holds no account at all,
 * and the console printing "Connecting" five hours later read as our binding
 * bug coming back, which it was not. With no provider account the row is a
 * sign-in that never finished, and it says so, with how long ago it started.
 */
export function adminAccountPill(
  a: AdminAccountRow,
  now: number = Date.now(),
): { tone: "positive" | "warning" | "danger" | "plain"; text: string } {
  if (!a.provider_account_id) {
    if (a.status === "connecting") return { tone: "plain", text: `sign-in not finished · started ${ago(a.created_at, now)}` };
    return { tone: "warning", text: "sign-in failed" };
  }
  if (a.status === "connecting") return { tone: "warning", text: "needs reconnecting" };
  if (a.status === "active") return { tone: "positive", text: a.first_action_at === null ? "active, idle" : "active" };
  return { tone: a.status === "restricted" ? "danger" : "warning", text: label(a.status) };
}
