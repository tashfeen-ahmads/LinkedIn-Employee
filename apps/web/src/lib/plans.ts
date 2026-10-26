import { LINKEDIN_LIMITS, SUSTAINED_INVITES_PER_DAY } from "@le/shared";

/**
 * The two plans, said once for the pricing page and the in-app plan cards.
 *
 * What separates them is how much Nora does on its own, never how many
 * invitations it sends: both get the same weekly limit, because the caps are
 * product rules (rule 4) and a plan that sent more would be a plan that
 * restricted more accounts. The extra on Autopilot buys hands-off booking.
 *
 * Yearly is two months free, said as months rather than a percentage because
 * that is how people work it out. The trial is fourteen days of Autopilot with
 * no card; the paid plans are charged through Stripe from the moment one is
 * chosen, or from the trial's end when it is chosen early.
 */
export type PlanKey = "pro" | "autopilot";
export type Interval = "month" | "year";

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** Who it is for, in one line. */
  bestFor: string;
  monthly: number;
  yearly: number;
}

export const PLANS: readonly PlanDefinition[] = [
  {
    key: "pro",
    name: "Nora Pro",
    bestFor: "For people who want to approve every message",
    monthly: 99,
    yearly: 990,
  },
  {
    key: "autopilot",
    name: "Nora Autopilot",
    bestFor: "For people who want meetings booked without doing anything",
    monthly: 179,
    yearly: 1790,
  },
];

export const TRIAL_DAYS = 14;

/** Two months free on a yearly plan, in dollars. */
export function yearlySaving(plan: PlanDefinition): number {
  return plan.monthly * 12 - plan.yearly;
}

/** What a yearly plan works out to each month, to the cent. */
export function yearlyPerMonth(plan: PlanDefinition): string {
  const value = plan.yearly / 12;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** The Stripe price key for a plan and interval, as the worker names them. */
export function priceKey(plan: PlanKey, interval: Interval): `${PlanKey}_${"monthly" | "yearly"}` {
  return `${plan}_${interval === "year" ? "yearly" : "monthly"}`;
}

/** A row of the comparison: the same on both, or one plan only. */
export interface PlanFeature {
  label: string;
  pro: string | boolean;
  autopilot: string | boolean;
}

export const PLAN_FEATURES: readonly PlanFeature[] = [
  { label: "Prospecting on regular LinkedIn and Sales Navigator", pro: true, autopilot: true },
  { label: "A personal note written for every person", pro: true, autopilot: true },
  {
    label: `Safe pacing: ${LINKEDIN_LIMITS.invitesPerDayStart} a day, growing to ${SUSTAINED_INVITES_PER_DAY}, never more than ${LINKEDIN_LIMITS.invitesPerWeek} a week`,
    pro: true,
    autopilot: true,
  },
  { label: "Automatic follow-ups", pro: true, autopilot: true },
  { label: "Unlimited campaigns", pro: true, autopilot: true },
  { label: "Replies drafted for you", pro: "You approve each one", autopilot: "Sent for you" },
  { label: "Meetings booked on your calendar", pro: "You confirm each one", autopilot: "Fully automatic" },
  { label: "Answers pricing questions from your own facts", pro: false, autopilot: true },
  { label: "CRM sync", pro: false, autopilot: true },
  { label: "Support", pro: "Email", autopilot: "Priority" },
];
