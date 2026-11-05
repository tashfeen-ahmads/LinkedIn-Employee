import { LINKEDIN_LIMITS, POST_SPACING_DAYS } from "@le/shared";

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

/**
 * Whether choosing a plan now starts billing straight away. Stripe refuses a
 * trial that ends within two days, so the worker carries the trial into
 * checkout only with more than 49 hours left (`server.ts`, checkout); inside
 * that, the first charge is the day they choose. One reading for every screen
 * that promises "no charge until the trial ends".
 */
export const TRIAL_CARRY_MIN_MS = 49 * 60 * 60_000;
export function chargesOnChoosing(trialEndsAt: string | null, now: Date = new Date()): boolean {
  if (!trialEndsAt) return true;
  return Date.parse(trialEndsAt) - now.getTime() <= TRIAL_CARRY_MIN_MS;
}

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

/**
 * A row of the comparison: the same on both, or one plan only.
 *
 * Read from what the code gates (`TIER_FEATURES` in `@le/billing`): replies
 * sent for you, booking, pricing answers and CRM sync are Autopilot's, and
 * everything else, likes, comments, posts and invitation cleanup included,
 * runs on both. `highlight` puts a shared row on the plan cards as well as in
 * the table, so somebody choosing Pro sees what they still get.
 */
export interface PlanFeature {
  label: string;
  pro: string | boolean;
  autopilot: string | boolean;
  highlight?: boolean;
}

export const PLAN_FEATURES: readonly PlanFeature[] = [
  { label: "Prospecting on regular LinkedIn and Sales Navigator", pro: true, autopilot: true },
  { label: "A personal note written for every person", pro: true, autopilot: true, highlight: true },
  {
    label: `Safe pacing: ${LINKEDIN_LIMITS.invitesPerDayStart} a day, rising to ${LINKEDIN_LIMITS.invitesPerDayMax}, never more than ${LINKEDIN_LIMITS.invitesPerWeek} a week`,
    pro: true,
    autopilot: true,
    highlight: true,
  },
  { label: "Profile views before inviting, to warm each person up", pro: true, autopilot: true },
  { label: "A first message written for each person who accepts", pro: true, autopilot: true },
  { label: "Automatic follow-ups", pro: true, autopilot: true, highlight: true },
  { label: "Lists that refill themselves while a campaign runs", pro: true, autopilot: true },
  { label: "Likes and short comments on your prospects' posts", pro: true, autopilot: true, highlight: true },
  { label: "LinkedIn posts written for you every week, each with a designed graphic", pro: true, autopilot: true, highlight: true },
  {
    label: `Approved posts scheduled and published for you, one every ${POST_SPACING_DAYS} days`,
    pro: true,
    autopilot: true,
    highlight: true,
  },
  {
    label: "Old unanswered invitations withdrawn automatically, to keep your account healthy",
    pro: true,
    autopilot: true,
    highlight: true,
  },
  { label: "Unlimited campaigns", pro: true, autopilot: true },
  { label: "Replies drafted for you", pro: "You approve each one", autopilot: "Sent for you" },
  { label: "Meetings booked on your calendar", pro: "You confirm each one", autopilot: "Fully automatic" },
  { label: "Answers pricing questions from your own facts", pro: false, autopilot: true },
  { label: "CRM sync", pro: false, autopilot: true },
  { label: "Support", pro: "Email", autopilot: "Priority" },
];
