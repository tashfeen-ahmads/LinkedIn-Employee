import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbSchema } from "@/components/schema";
import { Glance, PageHero } from "@/components/marketing";
import { NavIcon } from "@/components/icons";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";
import { BRAND } from "@le/shared";

export const metadata: Metadata = pageMeta({
  title: "Is an AI SDR safe for LinkedIn? Security at Nora",
  description:
    "Is an AI SDR safe for LinkedIn? Your password never reaches us, tokens are encrypted, tenants are isolated and sending stays inside daily limits.",
  path: "/security",
});

/** Two glyphs the shared set does not draw: a closed eye and a key. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="mk-icon"
    >
      {children}
    </svg>
  );
}

const EYE_OFF = (
  <Glyph>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.6 3.7" />
    <path d="M6.2 6.3C4.3 7.6 3 9.6 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 0 0 4.7-1.2" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Glyph>
);

const KEY = (
  <Glyph>
    <circle cx="7.5" cy="15.5" r="3.5" />
    <path d="M10 13l9-9" />
    <path d="M16 7l2.5 2.5" />
    <path d="M13.5 9.5l2 2" />
  </Glyph>
);

/** One claim each, and one glyph each, so no two claims look like the same claim. */
const POINTS: ReadonlyArray<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: EYE_OFF,
    title: "We never see your LinkedIn password",
    body: "You connect your account on our connection partner's own secure sign-in page. What comes back to us is an access token tied to your workspace, not a password anyone could sign in with.",
  },
  {
    icon: KEY,
    title: "Tokens are encrypted before they are stored",
    body: "Every access token we hold for you (LinkedIn, calendar, CRM) is encrypted with AES-256 before it is saved, using a key kept separately from the database. A copy of the database on its own is not enough to act as you.",
  },
  {
    icon: <NavIcon name="shield" className="mk-icon" />,
    title: "One workspace cannot read another",
    body: "The database itself checks that you belong to a workspace before it returns any of that workspace's data. Keeping customers apart does not depend on our application code remembering to.",
  },
  {
    icon: <NavIcon name="exclusions" className="mk-icon" />,
    title: "A prospect can be erased",
    body: "One click removes a person and everything written about them, and records that they must not be contacted again. That note is the only thing kept, because without it the next campaign would find them again.",
  },
  {
    icon: <NavIcon name="clock" className="mk-icon" />,
    title: "Old data is deleted on a schedule",
    body: "Prospect data older than your workspace's retention window is deleted automatically every night, whether or not anyone remembers to ask.",
  },
  {
    icon: <NavIcon name="posts" className="mk-icon" />,
    title: "Every message can be traced",
    body: "Each message records which version of our writing instructions produced it. If a campaign starts saying something wrong, we can find the exact change that caused it.",
  },
];

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
            {BRAND.name} acts on a real LinkedIn account and holds real information about real
            people. Here is how both are handled, in plain words rather than badges.
          </p>
        }
        aside={
          <Glance
            title="At a glance"
            items={[
              { label: "Your LinkedIn password", value: "Never reaches us" },
              { label: "Access tokens", value: "Encrypted with AES-256" },
              { label: "Other workspaces", value: "Cannot read yours" },
              { label: "Your data", value: "Export it any time" },
              { label: "SOC 2", value: "Not audited, and we say so" },
            ]}
          />
        }
      >
        <h1>Your account, your data, your call.</h1>
      </PageHero>

      <section className="mk-section mk-section-tight">
        <div className="container">
          <div className="fx4-sec-intro">
            <h2 className="mk-h2">Is an AI SDR safe for your LinkedIn account?</h2>
            <p className="fx4-sec-answer">
              Not unconditionally, and nobody can honestly say otherwise: LinkedIn&rsquo;s User
              Agreement prohibits automated access.
            </p>
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

      <section className="mk-section fx4-sec-data">
        <div className="container mk-stack">
          <h2 className="mk-h2">Where your data sits, and who can reach it</h2>
          <ul className="fx4-points">
            {POINTS.map((point) => (
              <li key={point.title}>
                <span className="mk-fact-icon">{point.icon}</span>
                <div>
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="fx4-sec-claim">
            <span className="mk-fact-icon" aria-hidden="true">
              <NavIcon name="support" className="mk-icon" />
            </span>
            <div>
              <h3>What we do not claim</h3>
              <p>
                We are not SOC 2 audited and we do not say we are. Ask us again when we have a
                report to hand you; until then, this page is the honest version.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
