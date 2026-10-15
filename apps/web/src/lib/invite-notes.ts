import { localMonth, localMonthStart, noteAllowance, planOf } from "@le/linkedin";
import type { createClient } from "@/lib/supabase-server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * A free account's invitation notes left this month, as the send path decides
 * them: the same count (`notesSentThisMonth` in the worker's send path, the
 * same two queries) fed to the same `noteAllowance`. Null on a paid plan.
 */
export async function notesLeftThisMonth(
  supabase: Client,
  account: {
    id: string;
    has_premium?: boolean | null;
    has_sales_navigator?: boolean | null;
    notes_exhausted_month?: string | null;
  },
  timezone: string,
): Promise<number | null> {
  const plan = planOf(account);
  if (plan !== "basic") return null;
  const now = new Date();
  const { data: campaigns } = await supabase.from("campaigns").select("id").eq("linkedin_account_id", account.id);
  const ids = (campaigns ?? []).map((c) => c.id);
  let sent = 0;
  if (ids.length) {
    const since = localMonthStart(now, timezone).toISOString();
    const [{ count: invited }, { count: withoutNote }] = await Promise.all([
      supabase.from("campaign_prospects").select("id", { count: "exact", head: true }).in("campaign_id", ids).gte("invited_at", since),
      supabase
        .from("campaign_prospects")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", ids)
        .gte("invited_at", since)
        .eq("invite_note_sent", false),
    ]);
    sent = Math.max(0, (invited ?? 0) - (withoutNote ?? 0));
  }
  return noteAllowance({
    plan,
    notesSentThisMonth: sent,
    exhaustedMonth: account.notes_exhausted_month,
    month: localMonth(now, timezone),
  }).remaining;
}
