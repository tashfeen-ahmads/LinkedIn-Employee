import type { Metadata } from "next";
import Link from "next/link";
import { Pricing } from "@/components/marketing";
import { BreadcrumbSchema, SoftwareSchema } from "@/components/schema";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Pricing — from $149 per seat, seven-day free trial",
  description:
    "Solo, Pro and Teams. Per seat, per month, billed to the number of reps actually sending. Seven-day free trial on every plan, no card to start.",
  path: "/pricing",
});

const QA = [
  {
    q: "What counts as a seat?",
    a: "One rep with one connected LinkedIn account. Nobody shares a login, so a seat is a person.",
  },
  {
    q: "Do I need Sales Navigator?",
    a: "It gives the Targeting Agent much better filters, so we recommend it on Pro and Teams. It is billed by LinkedIn, not by us. Solo works without one.",
  },
  {
    q: "What happens after the trial?",
    a: "Sending stops and reading does not. Your prospects, conversations and booked meetings stay exactly where they are until you choose a plan.",
  },
  {
    q: "Can I change plan later?",
    a: "Yes, in either direction, and the change takes effect on the next invoice.",
  },
];

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
      <Pricing />
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
            Still deciding? <Link href="/how-it-works">See what each agent actually does</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
