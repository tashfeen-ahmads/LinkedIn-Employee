import type { Metadata } from "next";
import Link from "next/link";
import { FREE_LINE, Faq, PageHero } from "@/components/marketing";
import { BreadcrumbSchema, SoftwareSchema } from "@/components/schema";
import { PUBLIC_LIMITS, SITE, pageMeta } from "@/lib/site";
import { BRAND } from "@le/shared";

/*
 * The route stays, because every link, bookmark and search result that ever
 * pointed at /pricing should land on the answer rather than a 404 or a hop to
 * a page that does not mention it. The answer is short, so the page is.
 *
 * A crossed-out price reads as a sale, and a sale is a promise about a later
 * price nobody has decided, so there are no plans here, greyed out or not.
 */
export const metadata: Metadata = pageMeta({
  title: "Free AI SDR for LinkedIn: Nora pricing, no card needed",
  description: `A free AI SDR for LinkedIn. ${FREE_LINE} Sign up and start right away: no plans, no card, and the same safety limits for every workspace.`,
  path: "/pricing",
});

const QA = [
  {
    q: "Is there a catch?",
    a: "No plan, no time limit and no card. Every workspace gets the whole team and the same limits. The caps that keep a LinkedIn account safe are product rules, not something a higher tier unlocks.",
  },
  {
    q: "Do I need to pay LinkedIn for anything?",
    a: "No. It works with any LinkedIn account. Sales Navigator, which LinkedIn sells separately, makes the search more precise; without it, the campaign tells you which filters could not be applied before you launch.",
  },
  {
    q: "What happens if it stops being free?",
    a: "You will hear it from us well before it does. Your prospects, conversations and booked meetings stay yours either way, and an owner or admin can export the whole workspace from the profile screen at any time.",
  },
];

/** What every workspace gets, said as facts the product enforces. */
const INCLUDED = [
  { label: "The whole team", value: "Sage, Scout, Quinn and Reese" },
  {
    label: "The same limits",
    value: `${PUBLIC_LIMITS.invitesPerDayStart} to ${PUBLIC_LIMITS.invitesPerDayMax} invitations a day, ${PUBLIC_LIMITS.invitesPerWeek} a week`,
  },
  { label: "Your data", value: "Exportable by an owner or admin at any time" },
  { label: "To start", value: "No card and no plan to choose" },
];

export default function PricingPage() {
  return (
    <>
      <SoftwareSchema />
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "Free for now", path: "/pricing" },
        ]}
      />

      <PageHero
        crumb="Pricing"
        lede={
          <p>
            No plans to compare and no card to enter. {BRAND.name} and the whole team, for every
            workspace, with the same safety limits.
          </p>
        }
        actions={
          <Link href={`${SITE.app}/signup`} className="btn large">
            Sign up free
          </Link>
        }
      >
        <h1>A free AI SDR for LinkedIn, for everyone while we grow</h1>
      </PageHero>

      <section className="mk-section mk-section-tight">
        <div className="container mk-split">
          <dl className="mk-ledger">
            {INCLUDED.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mk-head">
            <h2 className="mk-h2-sm">If that ever changes</h2>
            <p className="mk-lede">
              You will hear it from us well before it does, and nothing you have built here is held
              back to make the point.
            </p>
            <p className="mk-caption">
              Still deciding? <Link href="/how-it-works">See what each of them actually does</Link>,
              or <Link href="/linkedin-automation-limits">read the limits</Link>.
            </p>
          </div>
        </div>
      </section>

      <Faq items={QA} title="Before you ask" />
    </>
  );
}
