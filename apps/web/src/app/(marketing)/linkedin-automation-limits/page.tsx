import type { Metadata } from "next";
import Link from "next/link";
import { ArticleSchema, BreadcrumbSchema, FaqSchema } from "@/components/schema";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";
import { Reveal } from "@/components/reveal";

const TITLE = "LinkedIn automation limits in 2026: the numbers that keep an account safe";
const DESCRIPTION =
  "How many connection requests you can send a day, what the weekly ceiling is, why acceptance rate matters more than volume, and the warning signs that come before a restriction.";
const PATH = "/linkedin-automation-limits";
const PUBLISHED = "2026-09-10";

export const metadata: Metadata = pageMeta({ title: TITLE, description: DESCRIPTION, path: PATH });

const FAQ = [
  {
    q: "How many LinkedIn connection requests can I send per day in 2026?",
    a: `Between 20 and 25 a day is where most accounts are safe, and going consistently above 25 raises the risk of a restriction whatever the account's history. A new or recently warmed account should start nearer 10 and climb over several weeks. We cap sending at ${PUBLIC_LIMITS.invitesPerDayMax} a day at the very top of the ramp and start every account at ${PUBLIC_LIMITS.invitesPerDayStart}.`,
  },
  {
    q: "What is the weekly connection request limit?",
    a: `LinkedIn's own weekly ceiling sits around 100 to 200 depending on the account. We hold every account to ${PUBLIC_LIMITS.invitesPerWeek} a week, which is the bottom of that range, because the weekly figure is the one that catches people who spread a large daily number across a few days.`,
  },
  {
    q: "Does acceptance rate matter more than volume?",
    a: `Yes, and it is the part most people miss. Above roughly 30% acceptance an account reads as a person doing their job. Below about 15% it reads as a spammer regardless of how few invitations were sent. Volume is what people watch; acceptance is what LinkedIn watches.`,
  },
  {
    q: "Will LinkedIn restrict my account without warning?",
    a: "Rarely. There is usually a two to three day window where the account starts behaving oddly — search results thinning, invitations silently failing, an unexpected verification screen. That window is the chance to stop. An account that keeps sending through it is the one that gets restricted.",
  },
  {
    q: "Is LinkedIn automation against the terms of service?",
    a: "LinkedIn's user agreement prohibits automated access, and no tool can honestly promise zero risk. What a tool can do is stay far enough under the thresholds that the behaviour is indistinguishable from a person working their network, and stop the moment the platform pushes back. Anyone promising unlimited safe sending is selling you a restriction.",
  },
];

const SIGNS = [
  {
    sign: "Invitations stop being accepted at the usual rate",
    why: "The first thing to move, and the metric LinkedIn weighs most heavily. A rate sliding toward 15% is a targeting or copy problem that becomes a safety problem.",
  },
  {
    sign: "Search returns fewer results than it did",
    why: "Commercial search limits are applied quietly. Fewer results for the same query is a soft throttle, not a coincidence.",
  },
  {
    sign: "An unexpected verification or captcha screen",
    why: "The platform is checking whether a human is present. Continuing to send after one of these is the single most reliable way to lose the account.",
  },
  {
    sign: "Invitations appear sent but never arrive",
    why: "A shadow limit. The interface accepts the action and nothing reaches the recipient, so the only visible symptom is a collapsing acceptance rate.",
  },
];

export default function LimitsPage() {
  return (
    <>
      <ArticleSchema headline={TITLE} description={DESCRIPTION} path={PATH} published={PUBLISHED} />
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "LinkedIn automation limits", path: PATH },
        ]}
      />
      <FaqSchema items={FAQ} />

      <article className="section">
        <div className="narrow stack-7">
          <Reveal>
            <header className="stack-4">
              <nav className="eyebrow" aria-label="Breadcrumb">
                <Link href="/">Home</Link> / Limits
              </nav>
              <h1>LinkedIn automation limits in 2026</h1>
              <p className="lede prose">
                The safe numbers, where they come from, and the warning signs that arrive two or three
                days before a restriction does. These are also the limits this product enforces, so
                every figure below is one our own code refuses to exceed.
              </p>
              <p className="tiny subtle">
                Published {new Date(PUBLISHED).toLocaleDateString("en-GB", { dateStyle: "long" })}
              </p>
            </header>
          </Reveal>

          <section className="stack-4">
            <h2>The numbers</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th className="num">Commonly cited as safe</th>
                    <th className="num">What we enforce</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Connection requests a day</td>
                    <td className="num mono">20–25</td>
                    <td className="num mono">
                      {PUBLIC_LIMITS.invitesPerDayStart} → {PUBLIC_LIMITS.invitesPerDayMax}
                    </td>
                  </tr>
                  <tr>
                    <td>Connection requests a week</td>
                    <td className="num mono">100–200</td>
                    <td className="num mono">{PUBLIC_LIMITS.invitesPerWeek}</td>
                  </tr>
                  <tr>
                    <td>Messages a day</td>
                    <td className="num mono">50–100</td>
                    <td className="num mono">{PUBLIC_LIMITS.messagesPerDay}</td>
                  </tr>
                  <tr>
                    <td>Warm-up before full volume</td>
                    <td className="num mono">2–4 weeks</td>
                    <td className="num mono">{PUBLIC_LIMITS.warmupWeeks} weeks</td>
                  </tr>
                  <tr>
                    <td>Healthy acceptance rate</td>
                    <td className="num mono">above 30%</td>
                    <td className="num mono">{PUBLIC_LIMITS.healthyAcceptance}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small subtle">
              We sit at or below every commonly cited figure. That is a deliberate trade: a campaign
              that runs for a year at twenty a day reaches far more people than one that runs for six
              weeks at fifty and then loses the account.
            </p>
          </section>

          <section className="stack-4">
            <h2>Acceptance rate is the real limit</h2>
            <p className="prose">
              Volume is what operators watch. Acceptance is what LinkedIn watches. An account sending
              fifteen invitations a day at 12% acceptance is in more danger than one sending thirty at
              40%, because the first is demonstrably contacting people who do not want to hear from it
              and the second is demonstrably not.
            </p>
            <p className="prose">
              This is why targeting and copy are safety features rather than performance features. A
              vague ideal customer profile produces a list of near-misses, a list of near-misses
              produces a low acceptance rate, and a low acceptance rate produces a restriction. The
              chain runs in that order every time.
            </p>
            <div className="notice accent">
              <p>
                <strong>What we do about it.</strong> Acceptance is checked nightly per account. Below{" "}
                {PUBLIC_LIMITS.healthyAcceptance}% you get told, with the campaign named, while there
                is still time to fix the targeting rather than after the account is gone.
              </p>
            </div>
          </section>

          <section className="stack-4">
            <h2>The two or three days before a restriction</h2>
            <p className="prose">
              LinkedIn rarely restricts an account with no signal beforehand. There is almost always a
              window where things behave oddly first — and it is a window most tools sail straight
              through, because they are counting sends rather than watching outcomes.
            </p>
            <div className="grid grid-2">
              {SIGNS.map((item) => (
                <div key={item.sign} className="card stack-2">
                  <h3>{item.sign}</h3>
                  <p className="small muted">{item.why}</p>
                </div>
              ))}
            </div>
            <div className="notice accent">
              <p>
                <strong>What we do about it.</strong> Account health is polled every night and checked
                on the response to every single send. Anything other than a clean result pauses the
                account immediately and emails the rep. Sending resumes by itself once the platform
                reports the account healthy again.
              </p>
            </div>
          </section>

          <section className="stack-4">
            <h2>What no tool can promise</h2>
            <p className="prose">
              LinkedIn&rsquo;s user agreement prohibits automated access. That is a fact about the
              platform, not a detail a vendor can engineer away, and any tool claiming unlimited safe
              sending is selling you a restriction with extra steps.
            </p>
            <p className="prose">
              What a tool can honestly offer is this: stay far enough under the thresholds that the
              pattern is indistinguishable from a person working their own network, randomise the
              timing so it never looks like a scheduler, keep the acceptance rate high enough that
              nobody is reporting the messages, and stop the moment the platform pushes back. That is
              the whole safety model, and everything above is how it is enforced.
            </p>
          </section>

          <section className="stack-4">
            <h2>Common questions</h2>
            <div className="faq">
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p className="muted small">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <aside className="card raised stack-4">
            <h2>These limits are the product</h2>
            <p className="muted">
              Every number on this page is read from one constants file that the sending code checks
              before each action. They are not settings a campaign can raise — an account override may
              only make them stricter.
            </p>
            <div className="cluster">
              <Link href="/login" className="btn">
                Start 7-day free trial
              </Link>
              <Link href="/how-it-works" className="btn secondary">
                See how it works
              </Link>
            </div>
          </aside>
        </div>
      </article>
    </>
  );
}
