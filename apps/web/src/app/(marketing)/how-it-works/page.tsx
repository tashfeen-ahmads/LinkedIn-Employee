import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { Reveal } from "@/components/reveal";
import { AgentTimeline } from "@/components/agent-timeline";
import { Sequence, sequenceFor } from "@/components/sequence";
import { GateSimulator } from "@/components/gate-simulator";
import { NavIcon } from "@/components/icons";
import { PUBLIC_LIMITS, SITE, pageMeta } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/plans";
import { TOUR_STAGES, YOUR_DECISIONS } from "@le/shared";
import { TEAM_MEMBER, type MemberKey } from "@/lib/team";
import { BRAND } from "@le/shared";

export const metadata: Metadata = pageMeta({
  title: "How an AI SDR works: LinkedIn automation with your approval",
  description:
    "How an AI SDR for LinkedIn works, step by step: you approve the strategy, the words and the launch, and Nora's team does the rest inside safe limits.",
  path: "/how-it-works",
});

/*
 * The four the product's dashboard introduces, with the detail this page has
 * room for. Names come from `lib/team.ts`; what each one hands over is said
 * here because it is the point of this page.
 *
 * Each wears the icon of the screen its work lands on rather than an initial:
 * Sage and Scout share a first letter, and two identical "S" plates side by
 * side read as one teammate drawn twice.
 */
const AGENTS: ReadonlyArray<{
  key: MemberKey | null;
  name: string;
  icon: string;
  job: string;
  detail: string;
  output: string;
  then: string;
}> = [
  {
    key: "sage",
    name: `${TEAM_MEMBER.sage.name}, the strategist`,
    icon: "strategies",
    job: "Learns what you sell and to whom",
    detail:
      "Reads your website and LinkedIn page, then writes a business profile and three to five customer strategies: the pains, the buying signals, the opening angles and the search filters. Ask for more and it extends the list.",
    output: "Business profile, 3 to 5 strategies, search filters",
    then: "You approve one, and only that starts the search.",
  },
  {
    key: "scout",
    name: `${TEAM_MEMBER.scout.name}, the prospector`,
    icon: "prospects",
    job: "Finds the people",
    detail:
      "Searches with Sales Navigator if your account has it, and regular LinkedIn search if not. Opens every profile before it reaches the list, removes anyone you have already contacted or excluded, and scores the rest on fit. Filters it could not apply are named on the campaign.",
    output: "Ranked prospects with reasons, filters it could not apply",
    then: "Quinn gets a ranked list of real, checked people.",
  },
  {
    key: "quinn",
    name: `${TEAM_MEMBER.quinn.name}, the campaign writer`,
    icon: "campaigns",
    job: "Writes to each person",
    detail:
      "Builds the campaign and writes every connection note from that person's own headline, role and company, plus the follow-ups. Split a campaign across angles and it keeps the groups even, so a result means something. It hands you a draft, never a running campaign.",
    output: "A note per person, follow-ups, angles to test",
    then: "You approve the words, then one click launches it. The first invitation goes within seconds.",
  },
  {
    key: "reese",
    name: `${TEAM_MEMBER.reese.name}, the outreach lead`,
    icon: "inbox",
    job: "Sends, answers and books",
    detail:
      "Sends invitations and follow-ups under daily caps, spread across your working hours. Reads every reply before writing anything and drafts answers only from the documents you gave it. Offers only times you have open.",
    output: "Paced invitations, drafted replies, booked meetings",
    then: `At launch you choose: every reply waits for your approval, or ${TEAM_MEMBER.reese.name} answers and books on its own.`,
  },
  {
    key: null,
    name: "You",
    icon: "meetings",
    job: "Close",
    detail:
      "Booked meetings appear on your Meetings page with who the person is and why they matched. You spend the day in conversations rather than in a search box.",
    output: "A booked meeting, context to open with",
    then: "The part that was never going to be automated.",
  },
];

/** The stage's own word for whose it is. */
function ownerLabel(owner: (typeof TOUR_STAGES)[number]["owner"]): string {
  if (owner === "agent") return "Runs by itself";
  if (owner === "setup") return "Once, at signup";
  if (owner === "outside") return "Yours";
  return "Your decision";
}

export default function HowItWorksPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "How it works", path: "/how-it-works" },
        ]}
      />

      {/*
        The hero carries the one picture that explains the product fastest:
        what a single prospect actually receives, drawn by the same function
        the campaign screen uses, with the timings the product owns.
      */}
      <section className="mk-page-hero hero-wash">
        <div className="container hiw-hero">
          <nav className="mk-crumb hiw-hero-crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">How it works</span>
          </nav>
          <div className="mk-page-hero-inner">
            <h1>How an AI SDR for LinkedIn works</h1>
            <div className="mk-page-lede">
              <p>
                You approve a strategy, the words and the launch. {BRAND.name}&rsquo;s team does the
                rest, inside daily limits nobody can raise.
              </p>
            </div>
            <div className="mk-actions">
              <Link href={`${SITE.app}/signup`} className="btn large">
                Start a {TRIAL_DAYS}-day free trial
              </Link>
              <Link href="/linkedin-automation-limits" className="mk-textlink">
                Read the limits <span aria-hidden="true">→</span>
              </Link>
            </div>
            <dl className="hiw-glance">
              <div>
                <dt>Decisions that are yours</dt>
                <dd className="mk-num">{YOUR_DECISIONS.length}</dd>
              </div>
              <div>
                <dt>Invitations a day</dt>
                <dd className="mk-num">
                  {PUBLIC_LIMITS.invitesPerDayStart} to {PUBLIC_LIMITS.invitesPerDayMax}
                </dd>
              </div>
              <div>
                <dt>Weekly ceiling</dt>
                <dd className="mk-num">{PUBLIC_LIMITS.invitesPerWeek}</dd>
              </div>
            </dl>
          </div>
          <figure className="card raised hiw-hero-card">
            <figcaption className="hiw-card-title">What one prospect receives</figcaption>
            <Sequence
              steps={sequenceFor({
                warmUp: true,
                connectionNote:
                  "Hi Priya, saw you run partnerships at Calder & Finch. Curious how you keep track of who actually sends you work.",
                steps: [
                  {
                    step_number: 1,
                    delay_days: 0,
                    message:
                      "Thanks for connecting, Priya. Is partner referrals something you own there, or does it sit with marketing?",
                  },
                  {
                    step_number: 2,
                    delay_days: 4,
                    message:
                      "No worries if the timing is off. Here is the short version if it is ever useful: {{cta_link}}",
                  },
                ],
              })}
            />
          </figure>
        </div>
      </section>

      {/*
        The three, said before anything else rather than left to be counted
        out of the stages. Each is a gate in the code rather than a promise in
        a paragraph.
      */}
      <section className="mk-section">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">What actually needs you</h2>
            <p className="mk-lede">
              Three decisions. Everything else runs without you, and you can take any of it over:
              read drafts before they send, cut names off a list, or write a reply yourself.
            </p>
          </header>
          <ol className="mk-index">
            {YOUR_DECISIONS.map((decision, index) => (
              <li key={decision.title}>
                <span className="mk-index-n mk-num" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="mk-index-main">
                  <h3>{decision.title}</h3>
                  <p>{decision.detail}</p>
                </div>
                <p className="mk-index-why">
                  <strong>Why you and not us.</strong> {decision.because}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mk-section">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">Who does what</h2>
            <p className="mk-lede">
              {BRAND.name}&rsquo;s team is four jobs with names, each handing its work to the next.
              They are not people pretending to be people: every message goes out under your own
              name.
            </p>
          </header>
          <ol className="mk-team">
            {AGENTS.map((agent) => (
              <li key={agent.name} className={agent.key ? "mk-team-card" : "mk-team-card is-you"}>
                <div className="mk-team-head">
                  <span className="hiw-avatar" aria-hidden="true">
                    <NavIcon name={agent.icon} />
                  </span>
                  <div>
                    <h3>{agent.name}</h3>
                    <p className="mk-muted">{agent.job}</p>
                  </div>
                </div>
                <p>{agent.detail}</p>
                <dl className="mk-team-out">
                  <div>
                    <dt>Hands over</dt>
                    <dd>{agent.output}</dd>
                  </div>
                  <div>
                    <dt>Then</dt>
                    <dd>{agent.then}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mk-section">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">Watch one campaign, day by day</h2>
            <p className="mk-lede">
              Step through one example. Each step names who acted, and the square markers are the
              moments that wait for you.
            </p>
          </header>
          <Reveal>
            <AgentTimeline />
          </Reveal>
        </div>
      </section>

      <section className="mk-section">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">It knows when to stop</h2>
            <p className="mk-lede">
              Anyone can draft a reply. What matters is what it refuses to answer. Type something a
              prospect might send and watch which rule catches it.
            </p>
          </header>
          <GateSimulator />
        </div>
      </section>

      {/*
        The same list the tutorial inside the app renders, from
        packages/shared/src/tour.ts, caveats included: every limit below is one
        a customer meets in week one, and meeting it having been told is a
        different experience from meeting it having been sold the opposite.
      */}
      <section className="mk-section">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">Step by step, including the parts we cannot do</h2>
            <p className="mk-lede">Every stage from signing up to closing, marked with whose it is.</p>
          </header>

          <ol className="hiw-steps">
            {TOUR_STAGES.map((stage, index) => (
              <li key={stage.id} className="hiw-step">
                <span className="hiw-step-n mk-num" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="hiw-step-body">
                  <h3>{stage.title}</h3>
                  <span className="hiw-step-owner">{ownerLabel(stage.owner)}</span>
                  <p>{stage.owner === "decision" ? stage.youDo : stage.weDo}</p>
                  <p className="hiw-step-caveat">
                    <strong>Worth knowing.</strong> {stage.caveat}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="hiw-note">
            <strong>Sending is capped the whole way through.</strong> Whatever a campaign asks for,
            nothing leaves an account faster than {PUBLIC_LIMITS.invitesPerDayMax} invitations a day
            or {PUBLIC_LIMITS.invitesPerWeek} a week, and a new account starts at{" "}
            {PUBLIC_LIMITS.invitesPerDayStart}. <Link href="/linkedin-automation-limits">Why those numbers</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
