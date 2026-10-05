import type { Metadata } from "next";
import Link from "next/link";
import { FREE_LINE, FreeForNow } from "@/components/marketing";
import { BreadcrumbSchema, SoftwareSchema } from "@/components/schema";
import { pageMeta } from "@/lib/site";
import { NORA } from "@/lib/team";

/*
 * The route stays, because every link, bookmark and search result that ever
 * pointed at /pricing should land on the answer rather than a 404 or a hop to
 * a page that does not mention it. The answer is short, so the page is.
 */
export const metadata: Metadata = pageMeta({
  title: "Free for everyone, for now",
  description: `${FREE_LINE} Sign up and start right away: no plans and no card.`,
  path: "/pricing",
});

const QA = [
  {
    q: "Is there a catch?",
    a: "No plan, no time limit and no card. Every workspace gets the whole team and the same limits — the caps that keep a LinkedIn account safe are product rules, not something a higher tier unlocks.",
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
      <FreeForNow standalone />
      <section className="section band">
        <div className="narrow stack-5">
          <h2>Before you ask</h2>
          <div className="faq">
            {QA.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p className="muted small">{item.a}</p>
              </details>
            ))}
          </div>
          <p className="small subtle">
            Still deciding? <Link href="/#team">Meet {NORA} and the team</Link>, or{" "}
            <Link href="/how-it-works">see what each of them actually does</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
