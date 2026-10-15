import type { Metadata } from "next";
import Link from "next/link";
import { SalesNavigator } from "@/components/home";
import { Faq, PageHero } from "@/components/marketing";
import { BreadcrumbSchema, SoftwareSchema } from "@/components/schema";
import { PUBLIC_LIMITS, SITE, pageMeta } from "@/lib/site";
import { BRAND, FREE_NOTES_PER_MONTH } from "@le/shared";

/*
 * The route stays, because every link, bookmark and search result that ever
 * pointed at /pricing should land on the answer rather than a 404 or a hop to
 * a page that does not mention it. The answer is short, so the page is.
 *
 * A crossed-out price reads as a sale, and a sale is a promise about a later
 * price nobody has decided, so there is one plan card here and nothing greyed
 * out beside it. The card says "Free" in large type rather than a dollar
 * figure: no public page quotes a price (test/team.test.ts).
 */
export const metadata: Metadata = pageMeta({
  title: "Free AI SDR for LinkedIn: Nora pricing, no card needed",
  description:
    "A free AI SDR for LinkedIn. Free while we grow: no card, no plan to choose, and the same safety limits for every workspace.",
  path: "/pricing",
});

const QA = [
  {
    q: "Is there a catch?",
    a: "No plan to choose and no card. Every workspace gets the whole product and the same limits. The caps that keep a LinkedIn account safe are product rules, not something a higher tier unlocks.",
  },
  {
    q: "Do I need to pay LinkedIn for anything?",
    a: `No. It works with any LinkedIn account. A free account can add a note to only ${FREE_NOTES_PER_MONTH} invitations a month, LinkedIn's own limit; after that ${BRAND.name} sends invitations without one. Premium lifts that limit, and Sales Navigator also makes the search more precise. Without it, the campaign tells you which filters could not be applied before you launch.`,
  },
  {
    q: "Can I bring my team?",
    a: "Yes. Invite teammates to your workspace and each one connects their own LinkedIn account. Every account keeps its own daily and weekly limits, and nobody on your list is contacted twice, whichever teammate found them.",
  },
  {
    q: "Does anything go out before I say so?",
    a: "No. A strategy runs only after you approve it, and a campaign sends nothing until you have read its notes and pressed Launch. Replies are drafted for you to approve unless you switch on autopilot.",
  },
  {
    q: "What happens if it stops being free?",
    a: "You will hear it from us well before it does. Your prospects, conversations and booked meetings stay yours either way, and an owner or admin can download a full export of the workspace at any time.",
  },
];

/** What every workspace gets, said as facts the product enforces. */
const INCLUDED = [
  {
    label: "The whole product",
    value:
      "Strategy, prospect search, a personalized note for every invitation LinkedIn allows one on, follow-ups and meeting booking.",
  },
  {
    label: "The same safety limits",
    value: `${PUBLIC_LIMITS.invitesPerDayStart} to ${PUBLIC_LIMITS.invitesPerDayMax} invitations a day and ${PUBLIC_LIMITS.invitesPerWeek} a week, spread across your working hours.`,
  },
  {
    label: "Sales Navigator, if you have it",
    value: `Tick one box and ${BRAND.name} searches with Sales Navigator, filtering by seniority and company size too. A regular LinkedIn account works as well.`,
  },
  {
    label: "Replies you approve",
    value: `${BRAND.name} drafts each reply from your documents and you approve it, or switch on autopilot so clean replies go out on their own.`,
  },
  {
    label: "Your data, yours",
    value: "An owner or admin can download a full export of the workspace at any time.",
  },
];

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="fx4-check" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function PricingPage() {
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
            One plan for every workspace, with the whole of {BRAND.name} and the same safety limits
            for everyone.
          </p>
        }
      >
        <h1>A free AI SDR for LinkedIn, for everyone while we grow</h1>
      </PageHero>

      <section className="mk-section fx4-plan-section">
        <div className="container">
          <div className="fx4-plan">
            <div className="fx4-plan-price">
              <p className="fx4-plan-name">One plan</p>
              <p className="fx4-plan-amount">Free</p>
              <p className="fx4-plan-sub">Free while we grow. No card.</p>
              <Link href={`${SITE.app}/signup`} className="btn large fx4-plan-cta">
                Sign up free
              </Link>
              <p className="fx4-plan-note">
                Still deciding? <Link href="/how-it-works">See how it works</Link> or{" "}
                <Link href="/linkedin-automation-limits">read the limits</Link>.
              </p>
            </div>
            <div className="fx4-plan-body">
              <h2 className="fx4-plan-title">What every workspace gets</h2>
              <ul className="fx4-included">
                {INCLUDED.map((item) => (
                  <li key={item.label}>
                    <Check />
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.value}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <SalesNavigator />

      <Faq items={QA} title="Before you ask" />
    </>
  );
}
