import type { Metadata } from "next";
import Link from "next/link";
import { SalesNavigator } from "@/components/home";
import { Faq, PageHero } from "@/components/marketing";
import { BreadcrumbSchema, SoftwareSchema } from "@/components/schema";
import { PUBLIC_LIMITS, SITE, pageMeta } from "@/lib/site";
import { PLANS, PLAN_FEATURES, TRIAL_DAYS, yearlyPerMonth, yearlySaving } from "@/lib/plans";
import { BRAND, FREE_NOTES_PER_MONTH } from "@le/shared";

/*
 * Two plans, monthly or yearly, and a trial of the top one.
 *
 * Every number on this page is read from `lib/plans.ts`, never typed here, so
 * the pricing page and the plan cards inside the app cannot quote two
 * different prices. The monthly and yearly figures are both in the markup and
 * a radio switch shows one set (CSS only, no script), so the page is complete
 * before anything loads and a crawler reads both.
 *
 * What separates the plans is how much Nora does on its own, never how much it
 * sends: the caps are product rules (rule 4) and are the same on both.
 */
export const metadata: Metadata = pageMeta({
  title: "Nora pricing: Pro and Autopilot, 14-day free trial",
  description:
    "Two plans for an AI SDR on LinkedIn. Approve every message on Pro, or let Autopilot book meetings for you. 14-day free trial, no card.",
  path: "/pricing",
});

const [PRO, AUTOPILOT] = PLANS as [(typeof PLANS)[number], (typeof PLANS)[number]];

const QA = [
  {
    q: "Do I need a card for the trial?",
    a: `No. Every new workspace gets ${TRIAL_DAYS} days of ${AUTOPILOT.name}, the whole product, with no card. We email you two days before it ends. If you do not choose a plan, sending pauses and nothing is deleted.`,
  },
  {
    q: "What is the difference between the plans?",
    a: `How much ${BRAND.name} does on its own. On ${PRO.name} you approve every reply and confirm every booking. On ${AUTOPILOT.name} clean replies are sent for you, pricing questions are answered from your own facts, meetings go straight into your calendar and contacts sync to your CRM. Both send the same amount, on the same limits.`,
  },
  {
    q: "Why do both plans have the same sending limits?",
    a: `Because the limits are what keep your LinkedIn account safe, and a plan that sent more would be a plan that restricted more accounts. Every account starts at ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day, grows to ${PUBLIC_LIMITS.invitesPerDayMax} over ${PUBLIC_LIMITS.warmupWeeks} weeks and never sends more than ${PUBLIC_LIMITS.invitesPerWeek} a week.`,
  },
  {
    q: "Can I switch plans or pay yearly later?",
    a: "Yes. Change plan, switch between monthly and yearly, update your card or cancel from your billing settings at any time. Paying yearly gives you two months free.",
  },
  {
    q: "Do I need to pay LinkedIn for anything?",
    a: `No. It works with any LinkedIn account. A free account can add a note to only ${FREE_NOTES_PER_MONTH} invitations a month, LinkedIn's own limit; after that ${BRAND.name} sends invitations without one. Premium lifts that limit, and Sales Navigator also makes the search more precise.`,
  },
  {
    q: "Does anything go out before I say so?",
    a: "No. A strategy runs only after you approve it, and a campaign sends nothing until you have read its notes and pressed Launch.",
  },
];

/** The trial, day by day. A real sequence, so it is numbered by day. */
const TRIAL_STEPS = [
  { day: "Day 1", title: `${AUTOPILOT.name}, free`, body: "Sign up with no card. Every feature is on, so you see what hands-off looks like." },
  { day: `Day ${TRIAL_DAYS - 2}`, title: "A reminder", body: "We email you two days before the trial ends, with what it has done so far." },
  {
    day: `Day ${TRIAL_DAYS + 1}`,
    title: "You choose",
    body: `Keep ${AUTOPILOT.name}, or move to ${PRO.name} and approve every message yourself. If you choose neither, sending pauses and nothing is deleted.`,
  },
];

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="fx4-check" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Cell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <>
        <Check />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <span aria-hidden="true" className="pr-none">
          ×
        </span>
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span>{value}</span>;
}

export default function PricingPage() {
  const signup = `${SITE.app}/signup`;
  return (
    <>
      <SoftwareSchema />
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]}
      />

      <PageHero
        crumb="Pricing"
        lede={
          <p>
            Two plans with the same safe sending limits. What changes is how much {BRAND.name} does on its own.
            Everyone starts with {TRIAL_DAYS} days of {AUTOPILOT.name}, free, with no card.
          </p>
        }
      >
        <h1>Pricing</h1>
      </PageHero>

      <section className="mk-section pr-section" aria-label="Plans">
        <div className="container pr">
          <fieldset className="pr-period">
            <legend className="sr-only">Billing period</legend>
            <input type="radio" name="period" id="period-month" defaultChecked />
            <label htmlFor="period-month">Monthly</label>
            <input type="radio" name="period" id="period-year" />
            <label htmlFor="period-year">
              Yearly <span className="pr-badge">2 months free</span>
            </label>
          </fieldset>

          <div className="pr-cards">
            {PLANS.map((plan) => (
              <article key={plan.key} className={`pr-card${plan.key === "autopilot" ? " is-featured" : ""}`}>
                <header className="pr-card-head">
                  <h2 className="pr-card-name">{plan.name}</h2>
                  {plan.key === "autopilot" ? <p className="pr-card-flag">What your trial is</p> : null}
                </header>
                <p className="pr-card-for">{plan.bestFor}.</p>
                <div className="pr-price is-month">
                  <p className="pr-amount">
                    ${plan.monthly}
                    <span className="pr-unit">a month</span>
                  </p>
                  <p className="pr-note">Billed monthly. Cancel any time.</p>
                </div>
                <div className="pr-price is-year">
                  <p className="pr-amount">
                    ${yearlyPerMonth(plan)}
                    <span className="pr-unit">a month</span>
                  </p>
                  <p className="pr-note">
                    ${plan.yearly.toLocaleString("en-US")} billed yearly. Two months free, ${yearlySaving(plan)} saved.
                  </p>
                </div>
                <ul className="pr-points">
                  {PLAN_FEATURES.filter((f) => f.pro !== f.autopilot).map((feature) => {
                    const value = feature[plan.key];
                    return (
                      <li key={feature.label} className={value === false ? "is-off" : undefined}>
                        {value === false ? (
                          <span aria-hidden="true" className="pr-none">
                            ×
                          </span>
                        ) : (
                          <Check />
                        )}
                        <span>
                          {feature.label}
                          {typeof value === "string" ? <span className="pr-detail">{value}</span> : null}
                          {value === false ? <span className="sr-only"> (not included)</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Link href={signup} className={`btn large${plan.key === "autopilot" ? "" : " secondary"} pr-cta`}>
                  Start your {TRIAL_DAYS}-day free trial
                </Link>
              </article>
            ))}
          </div>
          <p className="pr-fineprint">
            Prices in US dollars. No card for the trial. Workspaces that joined while {BRAND.name} was free keep
            everything, free, for good.
          </p>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="compare">
        <div className="container mk-stack">
          <h2 id="compare" className="mk-h2">
            Everything on each plan
          </h2>
          <div className="table-scroll pr-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Feature</span>
                  </th>
                  {/* The short names: the cards above carry the full ones, and
                      "Nora Autopilot" clipped the column on a phone. */}
                  <th scope="col">Pro</th>
                  <th scope="col">Autopilot</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_FEATURES.map((feature) => (
                  <tr key={feature.label}>
                    <th scope="row">{feature.label}</th>
                    <td>
                      <Cell value={feature.pro} />
                    </td>
                    <td>
                      <Cell value={feature.autopilot} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="trial">
        <div className="container mk-stack">
          <h2 id="trial" className="mk-h2">
            How the trial works
          </h2>
          <ol className="pr-trial">
            {TRIAL_STEPS.map((step) => (
              <li key={step.day}>
                <p className="pr-trial-day">{step.day}</p>
                <h3 className="pr-trial-title">{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <SalesNavigator />

      <Faq items={QA} title="Before you ask" />
    </>
  );
}
