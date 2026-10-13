import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { Glance, PageHero } from "@/components/marketing";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";
import { BRAND } from "@le/shared";

export const metadata: Metadata = pageMeta({
  title: "About Nora: the AI SDR built around account safety",
  description:
    "Nora is an AI SDR for LinkedIn built around the constraint everyone else treats as an afterthought: not losing the LinkedIn account it runs on.",
  path: "/about",
});

/*
 * Who is behind it (a founder block with a name, photo, LinkedIn link, the
 * year and the place) belongs on this page and is deliberately absent until
 * the owner supplies it: inventing any of it would be a fabricated record.
 */

/** What autopilot never finishes on its own, however the workspace is set up. */
const ALWAYS_HELD = [
  {
    title: "A message the agent did not understand.",
    body: "A reply written from a misread message reaches a real person just as fast as a good one, so it waits for you.",
  },
  {
    title: "A prospect who asks to speak to a person.",
    body: "That is not our caution, it is their wish, and answering it with another automated message would ignore it.",
  },
  {
    title: "Anybody who asks to be removed.",
    body: "Everything stops for them, always, and they are never contacted again.",
  },
];

export default function AboutPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ]}
      />

      <PageHero
        crumb="About"
        lede={
          <p>
            Most outbound tools are built around volume and treat account safety as a settings page.
            We built {BRAND.name} the other way around.
          </p>
        }
      >
        <h1>Built around the thing that actually goes wrong.</h1>
      </PageHero>

      <section className="fx4-about">
        <div className="container fx4-about-grid">
          <div className="fx4-essay">
            <p>
              The failure that matters in LinkedIn outbound is not a campaign that underperforms. It
              is a rep losing the account their whole pipeline lives in, usually after two weeks of
              warning signs nobody was watching for. Rebuilding a network takes months, and no
              feature makes up for it.
            </p>
            <p>
              So the caps came first and everything else was built to fit inside them. Sending is
              checked against the limits twice: once when the day is planned, and again in the second
              before each message leaves, because minutes pass in between and the situation changes.
              Account health is checked every night and on every send. And nobody on your list is
              contacted twice, whichever teammate found them.
            </p>

            <h2 className="fx4-statement">Judgment stays yours. Typing does not.</h2>

            <p>
              Three things need you: the strategy, the words and the launch. Each is a step the
              product will not skip, rather than a promise in a paragraph. Everything after them can
              run unattended.
            </p>
            <p>
              How much it finishes on its own is your call, per workspace. Hold pricing, legal and
              anything negative for yourself, or let it answer and book. Three things are never left
              to autopilot, whatever you choose:
            </p>
            <ul className="fx4-held">
              {ALWAYS_HELD.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong> {item.body}
                </li>
              ))}
            </ul>
            <p>
              We publish the numbers we enforce, and we do not publish results we have not measured.
              When design partners produce real ones, they will appear here with their names on them.
            </p>
          </div>
          <aside className="fx4-about-aside" aria-label="The rules we built first">
          <Glance
            title="The rules we built first"
            items={[
              {
                label: "A new account",
                value: `${PUBLIC_LIMITS.invitesPerDayStart} invitations a day`,
              },
              {
                label: "Fully warmed",
                value: `${PUBLIC_LIMITS.invitesPerDayMax} a day, after ${PUBLIC_LIMITS.warmupWeeks} weeks`,
              },
              { label: "Any week", value: `Never past ${PUBLIC_LIMITS.invitesPerWeek}` },
              { label: "Each person", value: "Contacted once, never twice" },
              { label: "Anyone who opts out", value: "Never written to again" },
            ]}
            foot={<Link href="/linkedin-automation-limits">Why these numbers</Link>}
          />
          </aside>
        </div>
      </section>
    </>
  );
}
