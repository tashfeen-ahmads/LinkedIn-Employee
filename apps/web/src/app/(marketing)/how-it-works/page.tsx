import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { Reveal } from "@/components/reveal";
import { PageHero } from "@/components/marketing";
import { ProductFilm } from "@/components/product-film";
import { AgentTimeline } from "@/components/agent-timeline";
import { Sequence, sequenceFor } from "@/components/sequence";
import { GateSimulator } from "@/components/gate-simulator";
import { ReplyGate } from "@/components/diagrams";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";
import { TOUR_STAGES, YOUR_DECISIONS } from "@le/shared";
import { TeamAvatar } from "@/components/team-avatar";
import { type MemberKey } from "@/lib/team";
import { BRAND } from "@le/shared";

export const metadata: Metadata = pageMeta({
  title: "How an AI SDR works: LinkedIn automation with your approval",
  description:
    "How an AI SDR for LinkedIn works, step by step. Approve a strategy, approve the words, press launch. Sage, Scout, Quinn and Reese find the people, write to each one, answer the replies and book the calls.",
  path: "/how-it-works",
});

/*
 * The same four the product's dashboard introduces, with the detail this page
 * has room for. Names and roles come from `lib/team.ts`; what each one hands
 * over is said here because it is the point of this page.
 */
const AGENTS: ReadonlyArray<{
  key: MemberKey | null;
  name: string;
  job: string;
  detail: string;
  handover: string;
  output: string[];
}> = [
  {
    key: "sage",
    name: "Sage, the strategist",
    job: "Learns what you sell and to whom",
    detail:
      "Reads your website and LinkedIn page and writes a business profile plus three to five customer strategies, each with the pains, the buying signals, opening angles, and the search filters to execute it. Ask for more and it extends the list rather than starting again.",
    handover: "You approve one. That is what starts the search; there is no second button.",
    output: ["Business profile", "3 to 5 customer strategies", "Search filters per strategy"],
  },
  {
    key: "scout",
    name: "Scout, the prospector",
    job: "Finds the people",
    detail:
      "Searches LinkedIn on the tier your account actually has, opens every profile before it reaches the list, removes anyone your workspace has already contacted or excluded, and scores the rest on fit and intent. Filters it could not apply are named on the campaign, not quietly dropped.",
    handover: "Hands Quinn a ranked list of real, checked people.",
    output: ["Ranked prospects with reasons", "Filters it could not apply"],
  },
  {
    key: "quinn",
    name: "Quinn, the campaign writer",
    job: "Writes to each person",
    detail:
      "Builds the campaign and writes every connection note from that person's own headline, role and company, plus the follow-ups. Split a campaign across angles and it keeps the groups even, so a result means something. It hands you a draft campaign, never a running one.",
    handover: "You press Launch. Read the names and the messages first if you want to; nothing has left yet.",
    output: ["A note per person", "Follow-ups", "Angles to test"],
  },
  {
    key: "reese",
    name: "Reese, outreach and booking",
    job: "Sends, answers, and knows when not to",
    detail:
      "Sends the invitations and follow-ups under daily caps, spread across your working hours. Classifies every reply before writing anything, and answers only from the facts you gave it. You choose how much rope it gets: hold pricing, legal, security and anything negative for you, or let it answer and book on its own. Two things always wait: somebody who asks for a human, and a message it did not understand.",
    handover: "On autopilot it sends and books by itself. Set it to review instead and it waits for you.",
    output: ["Paced invitations", "Drafted replies", "Times you are genuinely free"],
  },
  {
    key: null,
    name: "You",
    job: "Close",
    detail:
      "Meetings booked through your booking page arrive with the whole conversation and the reasons the prospect matched. You spend the day in conversations rather than in a search box.",
    handover: "The part that was never going to be automated.",
    output: ["Booked meeting", "Context to open with"],
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

      <PageHero
        crumb="How it works"
        lede={
          <p>
            Approve a strategy, approve the words, press launch. From there {BRAND.name}&rsquo;s team finds
            the people, writes to each one by name, answers what comes back and books the calls,
            inside limits that keep the account alive. Anything you would rather do yourself, you
            still can.
          </p>
        }
      >
        <h1>How an AI SDR for LinkedIn works, with your approval at three points</h1>
      </PageHero>

      {/*
        The three, said before the stages rather than left to be counted out
        of them. Each is a gate in the code rather than a promise in a
        paragraph.
      */}
      <section className="mk-section">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">What actually needs you</h2>
            <p className="mk-lede">
              Three decisions. Nothing else is asked of you unless you ask for it.
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
          <p className="mk-caption mk-measure">
            Everything else runs without you: the search, the scoring, a note written for each
            person, the pacing, the follow-ups, the replies, the booking. Every one of them can be
            taken over by hand: read the drafts before they send, cut names off a list, write a
            reply yourself, or send one invitation now and watch what happens.
          </p>
        </div>
      </section>

      <section className="mk-section mk-tint">
        <div className="container mk-stack">
          <h2 className="mk-h2">Five stages, and what each one hands over.</h2>
          <ProductFilm />
        </div>
      </section>

      <section className="mk-section">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">Who does what</h2>
            <p className="mk-lede">
              Each teammate does one job and hands its work to the next. Names for the jobs, not
              people pretending to be people: every message still goes out under your own name.
            </p>
          </header>
          <ol className="mk-team">
            {AGENTS.map((agent) => (
              <li key={agent.name} className={agent.key ? "mk-team-card" : "mk-team-card is-you"}>
                <div className="mk-team-head">
                  {agent.key ? <TeamAvatar member={agent.key} /> : null}
                  <div>
                    <h3>{agent.name}</h3>
                    <p className="mk-muted">{agent.job}</p>
                  </div>
                </div>
                <p>{agent.detail}</p>
                <p className="mk-team-out">
                  <strong>Hands over:</strong> {agent.output.join(", ")}
                </p>
                <p className="mk-team-out">
                  <strong>Then:</strong> {agent.handover}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mk-section mk-tint">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">Watch one campaign, day by day.</h2>
            <p className="mk-lede">
              Step through an example below: every beat names who acted, and the square markers are
              the moments nothing moves without you.
            </p>
          </header>
          <Reveal>
            <AgentTimeline />
          </Reveal>
        </div>
      </section>

      {/*
        What a prospect actually receives: the same component the campaign
        screen draws, with a worked example in it, rendered by the same
        function with the same rules, including the steps a person may not
        move.
      */}
      <section className="mk-section" id="the-sequence">
        <div className="container mk-split">
          <header className="mk-head mk-split-aside">
            <h2 className="mk-h2">A conversation, not a blast.</h2>
            <p className="mk-lede">
              Every campaign runs the same shape. You write the words. The timing is a product rule,
              because the timing is what gets accounts restricted.
            </p>
          </header>
          <div className="card raised">
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
          </div>
        </div>
      </section>

      <section className="mk-section mk-tint">
        <div className="container mk-stack">
          <header className="mk-head">
            <h2 className="mk-h2">It knows when to stop.</h2>
            <p className="mk-lede">
              Anyone can draft a reply. The reason this can be left running is what it refuses to
              answer. Type something a prospect might send and watch which rule catches it.
            </p>
          </header>
          <div className="mk-pair">
            <GateSimulator />
            <ReplyGate />
          </div>
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
            <p className="mk-lede">
              Every stage from signing up to closing, marked with whose it is.
            </p>
          </header>

          <ol className="mk-stages">
            {TOUR_STAGES.map((stage) => (
              <li key={stage.id} className="mk-stage">
                <div className="mk-stage-head">
                  <h3>{stage.title}</h3>
                  <span className="mk-stage-owner">{ownerLabel(stage.owner)}</span>
                </div>
                {stage.youDo ? <p>{stage.youDo}</p> : null}
                <p className="mk-muted">{stage.weDo}</p>
                <p className="mk-stage-caveat">
                  <strong>Worth knowing.</strong> {stage.caveat}
                </p>
              </li>
            ))}
          </ol>

          <p className="mk-callout">
            <strong>Sending is capped the whole way through.</strong> Whatever a campaign asks for,
            nothing leaves an account faster than {PUBLIC_LIMITS.invitesPerDayMax} invitations a day
            or {PUBLIC_LIMITS.invitesPerWeek} a week, and a new account starts at{" "}
            {PUBLIC_LIMITS.invitesPerDayStart}.{" "}
            <Link href="/linkedin-automation-limits">Why those numbers</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
