import type { Metadata } from "next";
import { ArticleSchema, BreadcrumbSchema, FaqSchema } from "@/components/schema";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";
import { Faq, PageHero } from "@/components/marketing";
import { WarmupRamp } from "@/components/diagrams";
import { Forecast } from "@/components/forecast";

const TITLE = "LinkedIn connection request limit and automation limits in 2026";
const DESCRIPTION =
  "The LinkedIn connection request limit per day and per week, why acceptance rate matters more than volume, and the warning signs that come before a restriction.";
const PATH = "/linkedin-automation-limits";
const PUBLISHED = "2026-09-10";

/** The <title>: keyword first and under 60 characters; the H1 keeps the longer TITLE. */
const SEO_TITLE = "LinkedIn connection request limit in 2026: every number";

export const metadata: Metadata = pageMeta({ title: SEO_TITLE, description: DESCRIPTION, path: PATH });

/**
 * What the weekly ceiling works out to across a five-day working week.
 *
 * The daily cap at the top of the ramp is higher than the figure most guides
 * quote, and saying "we sit below every commonly cited figure" beside a table
 * showing 35 against 20 to 25 was a claim the page itself contradicted. The
 * honest version is arithmetic: the week binds before the day does.
 */
const WEEKDAY_AVERAGE = Math.floor(PUBLIC_LIMITS.invitesPerWeek / 5);

const FAQ = [
  {
    q: "How many LinkedIn connection requests can I send per day in 2026?",
    a: `Most guidance puts it at 20 to 25 a day for an established account, with a new account starting nearer 10 and climbing over several weeks. We start every account at ${PUBLIC_LIMITS.invitesPerDayStart} and ramp it over ${PUBLIC_LIMITS.warmupWeeks} weeks. A fully warmed account may send up to ${PUBLIC_LIMITS.invitesPerDayMax} on a single day, but never more than ${PUBLIC_LIMITS.invitesPerWeek} in a week, which averages ${WEEKDAY_AVERAGE} a day across a five-day working week.`,
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
    a: "Rarely. There is usually a two to three day window where the account starts behaving oddly: search results thinning, invitations silently failing, an unexpected verification screen. That window is the chance to stop. An account that keeps sending through it is the one that gets restricted.",
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

      <PageHero
        crumb="LinkedIn limits"
        lede={
          <>
            <p>
              The safe numbers, where they come from, and the warning signs that arrive two or three
              days before a restriction does. These are also the limits this product enforces, so
              every figure below is one our own code refuses to exceed.
            </p>
            <p className="mk-caption">
              Published {new Date(PUBLISHED).toLocaleDateString("en-GB", { dateStyle: "long" })}
            </p>
          </>
        }
      >
        <h1>LinkedIn automation limits in 2026</h1>
      </PageHero>

      <article className="mk-section mk-article">
        <div className="container mk-article-grid">
          <section className="mk-article-block">
            <h2 className="mk-h2-sm">The LinkedIn connection request limit, and the other numbers</h2>
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
                    <td className="num">20 to 25</td>
                    <td className="num">
                      {PUBLIC_LIMITS.invitesPerDayStart} rising to {PUBLIC_LIMITS.invitesPerDayMax}
                    </td>
                  </tr>
                  <tr>
                    <td>Connection requests a week</td>
                    <td className="num">100 to 200</td>
                    <td className="num">{PUBLIC_LIMITS.invitesPerWeek}</td>
                  </tr>
                  <tr>
                    <td>Messages a day</td>
                    <td className="num">50 to 100</td>
                    <td className="num">{PUBLIC_LIMITS.messagesPerDay}</td>
                  </tr>
                  <tr>
                    <td>Warm-up before full volume</td>
                    <td className="num">2 to 4 weeks</td>
                    <td className="num">{PUBLIC_LIMITS.warmupWeeks} weeks</td>
                  </tr>
                  <tr>
                    <td>Healthy acceptance rate</td>
                    <td className="num">above 30%</td>
                    <td className="num">{PUBLIC_LIMITS.healthyAcceptance}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mk-caption">
              One figure is above the usual guidance on purpose: a fully warmed account may send up
              to {PUBLIC_LIMITS.invitesPerDayMax} invitations on a single day. It cannot keep that
              up, because the weekly ceiling of {PUBLIC_LIMITS.invitesPerWeek} averages{" "}
              {WEEKDAY_AVERAGE} a day across a five-day week, and no account reaches that daily
              maximum until it has been sending for {PUBLIC_LIMITS.warmupWeeks} weeks. Everything
              else sits at or below the commonly cited figures. That is a deliberate trade: a
              campaign that runs for a year at twenty a day reaches far more people than one that
              runs for six weeks at fifty and then loses the account.
            </p>
          </section>

          <section className="mk-article-block">
            <WarmupRamp />
          </section>

          <section className="mk-article-block">
            <h2 className="mk-h2-sm">Acceptance rate is the real limit</h2>
            <p>
              Volume is what operators watch. Acceptance is what LinkedIn watches. An account sending
              fifteen invitations a day at 12% acceptance is in more danger than one sending thirty at
              40%, because the first is demonstrably contacting people who do not want to hear from it
              and the second is demonstrably not.
            </p>
            <p>
              This is why targeting and copy are safety features rather than performance features. A
              vague ideal customer profile produces a list of near-misses, a list of near-misses
              produces a low acceptance rate, and a low acceptance rate produces a restriction. The
              chain runs in that order every time.
            </p>
            <p className="mk-callout">
              <strong>What we do about it.</strong> Acceptance is checked nightly per account. Below{" "}
              {PUBLIC_LIMITS.healthyAcceptance}% you get told, with the campaign named, while there
              is still time to fix the targeting rather than after the account is gone.
            </p>
          </section>

          <section className="mk-article-block is-wide">
            <h2 className="mk-h2-sm">Move the sliders until it hits the ceiling</h2>
            <p>
              The daily slider stops at {PUBLIC_LIMITS.invitesPerDayMax} because the product stops
              there, and the weekly ceiling clamps the total underneath it.
            </p>
            <Forecast />
          </section>

          <section className="mk-article-block">
            <h2 className="mk-h2-sm">The two or three days before a restriction</h2>
            <p>
              LinkedIn rarely restricts an account with no signal beforehand. There is almost always a
              window where things behave oddly first, and it is a window most tools sail straight
              through, because they are counting sends rather than watching outcomes.
            </p>
          </section>
          <ol className="mk-signs is-wide">
            {SIGNS.map((item) => (
              <li key={item.sign}>
                <h3>{item.sign}</h3>
                <p>{item.why}</p>
              </li>
            ))}
          </ol>
          <section className="mk-article-block">
            <p className="mk-callout">
              <strong>What we do about it.</strong> Account health is polled every night and checked
              on the response to every single send. Anything other than a clean result pauses the
              account immediately and emails the rep. Sending resumes by itself once the platform
              reports the account healthy again.
            </p>
          </section>

          <section className="mk-article-block">
            <h2 className="mk-h2-sm">What no tool can promise</h2>
            <p>
              LinkedIn&rsquo;s user agreement prohibits automated access. That is a fact about the
              platform, not a detail a vendor can engineer away, and any tool claiming unlimited safe
              sending is selling you a restriction with extra steps.
            </p>
            <p>
              What a tool can honestly offer is this: stay far enough under the thresholds that the
              pattern is indistinguishable from a person working their own network, randomise the
              timing so it never looks like a scheduler, keep the acceptance rate high enough that
              nobody is reporting the messages, and stop the moment the platform pushes back. That is
              the whole safety model, and everything above is how it is enforced.
            </p>
            <p className="mk-callout">
              <strong>These limits are the product.</strong> Every number on this page is read from
              one constants file that the sending code checks before each action. They are not
              settings a campaign can raise; an account override may only make them stricter.
            </p>
          </section>
        </div>
      </article>

      <Faq items={FAQ} title="Common questions about LinkedIn limits" />
    </>
  );
}
