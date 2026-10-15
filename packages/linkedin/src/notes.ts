import { FREE_NOTES_PER_MONTH } from "@le/shared";
import { localDate, localDayStart } from "./rate-limit.js";

/**
 * Which LinkedIn plan an account is on, as far as sending is concerned.
 *
 * Three answers, because they differ in two separate ways. Sales Navigator
 * changes what a search can filter on (rule 12). Any paid plan, Premium or
 * Sales Navigator, lifts LinkedIn's monthly limit on invitation notes, which a
 * free account has and is the one this file is about.
 */
export type LinkedInPlan = "basic" | "premium" | "sales_navigator";

export function planOf(account: { has_premium?: boolean | null; has_sales_navigator?: boolean | null }): LinkedInPlan {
  if (account.has_sales_navigator) return "sales_navigator";
  if (account.has_premium) return "premium";
  return "basic";
}

/** The plan in a buyer's words. */
export function planLabel(plan: LinkedInPlan): string {
  return plan === "sales_navigator" ? "Sales Navigator" : plan === "premium" ? "Premium" : "Free (Basic)";
}

/** The rep's own month, `YYYY-MM`. Notes reset with LinkedIn's month, read in the rep's zone. */
export function localMonth(now: Date, timezone: string): string {
  return localDate(now, timezone).slice(0, 7);
}

/**
 * The instant the rep's month began. Counted back from today's local midnight
 * in whole days, so a daylight-saving change inside the month moves it by an
 * hour at most, which for counting a handful of notes is nothing.
 */
export function localMonthStart(now: Date, timezone: string): Date {
  const day = Number(localDate(now, timezone).slice(8, 10));
  return new Date(localDayStart(now, timezone).getTime() - (day - 1) * 86_400_000);
}

export interface NoteAllowance {
  /** Whether this invitation may carry a note. */
  allowed: boolean;
  /** Notes left this month, or null when the plan has no limit. */
  remaining: number | null;
  /** Why not, in plain words, when `allowed` is false. */
  reason?: string;
}

/**
 * May the next invitation carry a note?
 *
 * Free accounts get FREE_NOTES_PER_MONTH, counted from what this product
 * actually sent this month across every campaign on the account. A month in
 * which LinkedIn has already refused a note is spent whatever the count says:
 * the count is ours, the refusal is LinkedIn's, and a note on someone else's
 * invitation sent from LinkedIn directly counts against the same allowance.
 *
 * Without a note the invitation still goes (that is ordinary on LinkedIn and
 * is what a free account is allowed). This decides the note, never the send.
 */
export function noteAllowance(input: {
  plan: LinkedInPlan;
  notesSentThisMonth: number;
  exhaustedMonth: string | null | undefined;
  month: string;
}): NoteAllowance {
  if (input.plan !== "basic") return { allowed: true, remaining: null };
  if (input.exhaustedMonth === input.month) {
    return {
      allowed: false,
      remaining: 0,
      reason: "LinkedIn says this free account has used its invitation notes for the month",
    };
  }
  const used = Number.isFinite(input.notesSentThisMonth) ? Math.max(0, Math.floor(input.notesSentThisMonth)) : FREE_NOTES_PER_MONTH;
  const remaining = Math.max(0, FREE_NOTES_PER_MONTH - used);
  if (remaining === 0) {
    return {
      allowed: false,
      remaining: 0,
      reason: `A free LinkedIn account may add a note to ${FREE_NOTES_PER_MONTH} invitations a month, and this month's are used`,
    };
  }
  return { allowed: true, remaining };
}
