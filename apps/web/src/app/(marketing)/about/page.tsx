import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "About — why this is built the way it is",
  description:
    "An AI SDR built around the constraint everyone else treats as an afterthought: not losing the LinkedIn account it runs on.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ]}
      />

      <section className="section">
        <div className="narrow stack-6">
          <header className="stack-4">
            <p className="eyebrow">About</p>
            <h1>Built around the thing that actually goes wrong.</h1>
          </header>

          <p className="lede">
            Most outbound tools are built around volume and treat account safety as a settings page.
            We built this the other way round.
          </p>

          <div className="stack-4 prose muted">
            <p>
              The failure that matters in LinkedIn outbound is not a campaign that underperforms. It
              is a rep losing the account their whole pipeline lives in, usually after a fortnight of
              warning signs nobody was watching for. Rebuilding a network takes months and no feature
              makes up for it.
            </p>
            <p>
              So the caps came first and everything else was built to fit inside them. Sending is
              checked against the limiter twice — once when the day is planned and again in the second
              before each message leaves — because minutes pass in between and the situation changes.
              Account health is polled nightly and read from every response. The list is deduplicated
              across the whole team so two reps never arrive in the same inbox.
            </p>
            <p>
              The second decision was that judgement stays yours and typing does not. Three things
              need you — the strategy, the words, the launch — and each is a gate in the code rather
              than a promise in a paragraph. Everything after them can run unattended.
            </p>
            <p>
              How much it finishes on its own is your call, per workspace. Hold pricing, legal and
              anything negative for yourself, or let it answer and book. Two holds you cannot switch
              off, and they are not the same kind of thing: a message the agent did not understand,
              because a reply written from a misread one reaches a real person just as fast as a
              good one; and a prospect who asks to speak to a human, because that one is not our
              caution, it is their wish. Somebody asking to remove them stops everything, always.
            </p>
            <p>
              We publish the numbers we enforce, and we do not publish results we have not measured.
              When design partners produce real ones, those will appear here with their names on them.
            </p>
          </div>

          <div className="cluster">
            <Link href="/how-it-works" className="btn">
              See how it works
            </Link>
            <Link href="/linkedin-automation-limits" className="btn secondary">
              Read the limits
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
