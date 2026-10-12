import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { PageHero } from "@/components/marketing";
import { NavIcon } from "@/components/icons";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Is an AI SDR safe for LinkedIn? Security at Nora",
  description:
    "Is an AI SDR safe for LinkedIn? What no tool can promise, and what Nora does: your LinkedIn password never reaches us, tokens are encrypted before storage, every tenant is isolated, and sending stays inside daily limits.",
  path: "/security",
});

const POINTS = [
  {
    icon: "lock",
    title: "We never see your LinkedIn password",
    body: "Connecting an account happens on the provider's own hosted page. What comes back is a token bound to your workspace, not a credential we could sign in with.",
  },
  {
    icon: "lock",
    title: "Tokens are encrypted before they are stored",
    body: "Every OAuth credential (LinkedIn, calendar, CRM) is encrypted with AES-256-GCM before it touches the database, using a key held only by the worker. A copy of the database on its own is not enough to act as you.",
  },
  {
    icon: "shield",
    title: "One workspace cannot read another",
    body: "Every table carrying customer data has row-level security keyed to workspace membership, enforced by the database rather than by application code remembering to filter.",
  },
  {
    icon: "exclusions",
    title: "A prospect can be erased",
    body: "One click removes a person and everything written about them, and records that they must not be contacted again. The record of the erasure is the only thing that survives it, because otherwise the next campaign would find them afresh.",
  },
  {
    icon: "clock",
    title: "Retention is a limit, not a promise",
    body: "Prospect data older than the workspace's retention window is deleted by a nightly sweep, whether or not anyone remembers to ask.",
  },
  {
    icon: "posts",
    title: "Every message is attributable",
    body: "Each sent message records the prompt version that produced it. If a campaign starts saying something wrong, the change that caused it is one query away.",
  },
] as const;

export default function SecurityPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "Security", path: "/security" },
        ]}
      />

      <PageHero
        crumb="Security"
        lede={
          <p>
            This product acts on a real LinkedIn account and holds real information about real
            people. Both deserve stating plainly rather than a badge.
          </p>
        }
      >
        <h1>Your account, your data, your call.</h1>
      </PageHero>

      <section className="mk-section mk-section-tight">
        <div className="container mk-split">
          <header className="mk-head mk-split-aside">
            <h2 className="mk-h2">Is an AI SDR safe for your LinkedIn account?</h2>
            <p className="mk-lede">
              Not unconditionally, and nobody can honestly say otherwise: LinkedIn&rsquo;s user
              agreement prohibits automated access.
            </p>
          </header>
          <div className="mk-prose">
            <p>
              What a tool can do is keep the volume well under the line and stop the moment the
              platform pushes back. Here every account starts at {PUBLIC_LIMITS.invitesPerDayStart}{" "}
              connection requests a day, ramps to {PUBLIC_LIMITS.invitesPerDayMax} over{" "}
              {PUBLIC_LIMITS.warmupWeeks} weeks, never passes {PUBLIC_LIMITS.invitesPerWeek} a week,
              and spreads each day across your working hours.
            </p>
            <p>
              A warning, a captcha or an unusual login screen pauses the account and tells you.{" "}
              <Link href="/linkedin-automation-limits">Where those numbers come from</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="mk-section mk-tint">
        <div className="container mk-stack">
          <h2 className="mk-h2">Where your data sits, and who can reach it</h2>
          <ul className="mk-points">
            {POINTS.map((point) => (
              <li key={point.title}>
                <span className="mk-fact-icon">
                  <NavIcon name={point.icon} className="mk-icon" />
                </span>
                <h3>{point.title}</h3>
                <p>{point.body}</p>
              </li>
            ))}
          </ul>

          <p className="mk-callout">
            <strong>What we do not claim.</strong> We are not SOC 2 audited and we do not say we are.
            Ask us again when we have a report to hand you, and in the meantime take this page as the
            honest version.
          </p>
        </div>
      </section>
    </>
  );
}
