import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { Reveal } from "@/components/reveal";
import { PUBLIC_LIMITS, SITE, pageMeta } from "@/lib/site";
import { TOUR_STAGES, YOUR_DECISIONS } from "@le/shared";
import { TeamAvatar } from "@/components/team-avatar";
import { NORA, type MemberKey } from "@/lib/team";

export const metadata: Metadata = pageMeta({
  title: `How it works — ${NORA}, a team of four, and three decisions`,
  description:
    "Approve a strategy, approve the words, press launch. Sage, Scout, Quinn and Reese find the people, write to each one, answer the replies and book the calls. Anything you would rather do yourself, you can.",
  path: "/how-it-works",
});

/*
 * The same four the home page introduces, with the detail this page has room
 * for. Names and roles come from `lib/team.ts`; what each one hands over is
 * said here because it is the point of this page.
 */
const AGENTS: ReadonlyArray<{
  n: string;
  key: MemberKey | null;
  name: string;
  job: string;
  detail: string;
  handover: string;
  output: string[];
}> = [
  {
    n: "01",
    key: "sage",
    name: "Sage, the strategist",
    job: "Learns what you sell and to whom",
    detail:
      "Reads your website and LinkedIn page and writes a business profile plus three to five customer strategies — each with the pains, the buying signals, opening angles, and the search filters to execute it. Ask for more and it extends the list rather than starting again.",
    handover: "You approve one. That is what starts the search — there is no second button.",
    output: ["Business profile", "3–5 customer strategies", "Search filters per strategy"],
  },
  {
    n: "02",
    key: "scout",
    name: "Scout, the prospector",
    job: "Finds the people",
    detail:
      "Searches LinkedIn on the tier your account actually has, opens every profile before it reaches the list, removes anyone your workspace has already contacted or excluded, and scores the rest on fit and intent. Filters it could not apply are named on the campaign, not quietly dropped.",
    handover: "Hands Quinn a ranked list of real, checked people.",
    output: ["Ranked prospects with reasons", "Filters it could not apply"],
  },
  {
    n: "03",
    key: "quinn",
    name: "Quinn, the campaign writer",
    job: "Writes to each person",
    detail:
      "Builds the campaign and writes every connection note from that person's own headline, role and company, plus the follow-ups. Split a campaign across angles and it keeps the groups even, so a result means something. It hands you a draft campaign, never a running one.",
    handover: "You press Launch. Read the names and the messages first if you want to; nothing has left yet.",
    output: ["A note per person", "Follow-ups", "Angles to test"],
  },
  {
    n: "04",
    key: "reese",
    name: "Reese, outreach and booking",
    job: "Sends, answers, and knows when not to",
    detail:
      "Sends the invitations and follow-ups under daily caps, spread across your working hours. Classifies every reply before writing anything, and answers only from the facts you gave it. You choose how much rope it gets: hold pricing, legal, security and anything negative for you, or let it answer and book on its own. Two things always wait — somebody who asks for a human, and a message it did not understand.",
    handover: "On autopilot it sends and books by itself. Set it to review instead and it waits for you.",
    output: ["Paced invitations", "Drafted replies", "Times you are genuinely free"],
  },
  {
    n: "05",
    key: null,
    name: "You",
    job: "Close",
    detail:
      "Meetings booked through your booking page arrive with the whole conversation and the reasons the prospect matched. You spend the day in conversations rather than in a search box.",
    handover: "The part that was never going to be automated.",
    output: ["Booked meeting", "Context to open with"],
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "How it works", path: "/how-it-works" },
        ]}
      />

      <section className="section">
        <div className="container stack-7">
          <Reveal>
            <header className="stack-4">
              <p className="eyebrow">How it works</p>
              <h1>{NORA}, a team of four, and three decisions.</h1>
              <p className="lede prose">
                Approve a strategy, approve the words, press launch. From there {NORA}&rsquo;s team
                finds the people, writes to each one by name, answers what comes back and books the
                calls — unattended, inside limits that keep the account alive. {NORA} passes the
                work along and tells you when something needs you. Anything you would rather do
                yourself, you still can.
              </p>
            </header>
          </Reveal>

          {/*
            The three, said before the ten stages rather than left to be
            counted out of them. Somebody reading the stage list concluded the
            founder does most of the work — six of its nine titles opened with
            the word "You" — and they were reading it correctly: it described
            the supervised default as though it were the only mode, and counted
            one-time setup as recurring work. The honest version is short
            enough to say out loud.
          */}
          <Reveal>
            <section className="stack-4">
              <header className="stack-2">
                <h2>What actually needs you</h2>
                <p className="muted prose">
                  Three decisions, and each is a gate in the code rather than a promise in a
                  paragraph. Nothing else is asked of you unless you ask for it.
                </p>
              </header>
              <ol className="stack-3 steps">
                {YOUR_DECISIONS.map((decision, index) => (
                  <li key={decision.title} className="card">
                    <div className="cluster">
                      <span className="eyebrow">{String(index + 1).padStart(2, "0")}</span>
                      <h3>{decision.title}</h3>
                    </div>
                    <p className="prose">{decision.detail}</p>
                    <p className="small prose">
                      <span className="eyebrow">Why you and not us</span>{" "}
                      <span className="muted">{decision.because}</span>
                    </p>
                  </li>
                ))}
              </ol>
              <p className="small muted prose">
                Everything else — the search, the scoring, a note written for each person, the
                pacing, the follow-ups, the replies, the booking — runs without you. Every one of
                them can be taken over by hand if you would rather: read the drafts before they
                send, cut names off a list, write a reply yourself, or send one invitation now and
                watch what happens.
              </p>
            </section>
          </Reveal>

          <ol className="stack-5 agents">
            {AGENTS.map((agent) => (
              <li key={agent.n} className="card agent-row">
                <div className="agent-mark">
                  {agent.key ? <TeamAvatar member={agent.key} /> : null}
                  <span className="eyebrow">{agent.n}</span>
                </div>
                <div className="stack-3 grow">
                  <div className="stack-2">
                    <h2>{agent.name}</h2>
                    <p className="lede" style={{ fontSize: "1.05rem" }}>
                      {agent.job}
                    </p>
                  </div>
                  <p className="muted prose">{agent.detail}</p>
                  <div className="cluster">
                    {agent.output.map((item) => (
                      <span key={item} className="pill plain">
                        {item}
                      </span>
                    ))}
                  </div>
                  <p className="small">
                    <span className="eyebrow">Handover</span>{" "}
                    <span className="muted">{agent.handover}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/*
            The same list the tutorial inside the app renders, from
            packages/shared/src/tour.ts. The two used to be written separately
            and had already drifted — this page promised a calendar integration
            that had been removed from the product. A promise made on the way in
            and missing on the way round does not read as a misunderstanding.

            Including the caveats on a marketing page is deliberate. Every limit
            below is one a customer meets in week one, and meeting it having
            been told is a different experience from meeting it having been
            sold the opposite.
          */}
          <Reveal>
            <section className="stack-5">
              <header className="stack-2">
                <h2>Step by step, including the parts we cannot do</h2>
                <p className="muted prose">
                  Every stage from signing up to closing, marked with whose it is: answered once at
                  signup, one of your three decisions, or run by the agents.
                </p>
              </header>

              <ol className="stack-4 steps">
                {TOUR_STAGES.map((stage, index) => (
                  <li key={stage.id} className="card">
                    <div className="cluster">
                      <span className="eyebrow">{String(index + 1).padStart(2, "0")}</span>
                      <h3>{stage.title}</h3>
                      {/*
                        The stage's own word for whose it is, rather than
                        "does this have a youDo" — which counted signing up as
                        ongoing work and, once the agent started answering
                        replies on its own, was simply wrong about the busiest
                        stage in the product.
                      */}
                      <span className="pill plain">
                        {stage.owner === "agent"
                          ? "runs by itself"
                          : stage.owner === "setup"
                            ? "once, at signup"
                            : stage.owner === "outside"
                              ? "yours"
                              : "your decision"}
                      </span>
                    </div>
                    {stage.youDo ? <p className="prose">{stage.youDo}</p> : null}
                    <p className="muted prose">{stage.weDo}</p>
                    <p className="small prose">
                      <span className="eyebrow">Worth knowing</span>{" "}
                      <span className="muted">{stage.caveat}</span>
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </Reveal>

          <div className="notice accent">
            <p>
              <strong>Sending is capped the whole way through.</strong> Whatever a campaign asks for,
              nothing leaves an account faster than {PUBLIC_LIMITS.invitesPerDayMax} invitations a day
              or {PUBLIC_LIMITS.invitesPerWeek} a week, and a new account starts at{" "}
              {PUBLIC_LIMITS.invitesPerDayStart}.{" "}
              <Link href="/linkedin-automation-limits">Why those numbers</Link>.
            </p>
          </div>

          <div className="cluster">
            <Link href={`${SITE.app}/signup`} className="btn large">
              Sign up free
            </Link>
            <Link href="/#team" className="btn secondary large">
              Meet the team
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
