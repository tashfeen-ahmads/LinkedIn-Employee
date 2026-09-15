import { redirect } from "next/navigation";
import { createClient } from "./supabase-server";
import { isAppConfigured } from "./config";

export interface AdminSession {
  userId: string;
  email: string;
}

/**
 * The gate on every operator page.
 *
 * Membership of `platform_admins` is what the database's own policies check, so
 * this asks the database rather than deciding for itself: a page that believed
 * someone was an admin when the policies disagreed would render a console full
 * of empty tables, which reads as a broken product rather than a refusal.
 *
 * Someone who is not an admin is sent to /app, not shown a "forbidden" page.
 * There is nothing here for them and no reason to tell them it exists.
 */
export async function requirePlatformAdmin(): Promise<AdminSession> {
  if (!isAppConfigured()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error) {
    console.error("platform admin check failed", error);
    redirect("/app");
  }
  if (!isAdmin) redirect("/app");

  return { userId: user.id, email: user.email ?? "" };
}

/** Per-workspace counts for the tables an operator may not read row by row. */
export interface WorkspaceStats {
  workspace_id: string;
  prospects: number;
  conversations: number;
  pending_drafts: number;
  messages_sent: number;
}

export function statsByWorkspace(rows: WorkspaceStats[] | null): Map<string, WorkspaceStats> {
  return new Map((rows ?? []).map((row) => [row.workspace_id, row]));
}

/** Days until a date, negative once it has passed. Null stays null. */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function formatUsd(total: number): string {
  if (total === 0) return "$0.00";
  return total < 0.01 ? "<$0.01" : `$${total.toFixed(2)}`;
}
