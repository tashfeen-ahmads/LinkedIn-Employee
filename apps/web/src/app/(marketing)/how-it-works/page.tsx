import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { Reveal } from "@/components/reveal";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "How it works — four agents and the handovers between them",
  description:
    "The Strategy Agent writes your customer profiles, Targeting builds the list, Reply answers and books, and you close. Every handover has a human in it.",
  path: "/how-it-works",
});

const AGENTS = [
  {
    n: "01",
    name: "Strategy Agent",
    job: "Learns what you sell and to whom",
    detail:
      "It reads your website and LinkedIn page and writes a business profile plus three to five customer profiles — each with the pains, the buying signals, three opening angles, and the Sales Navigator filters to execute it.",
    handover: "You read them and approve. Nothing is searched for until you do.",
    output: ["Business profile", "3–5 customer profiles", "Search filters per profile"],
  },
  {
    n: "02",
    name: "Targeting Agent",
    job: "Builds the list and the campaign",
    detail:
      "It searches, removes anyone your workspace has already touched or excluded, scores the rest on fit and intent, and writes the connection note and follow-ups. It hands you a draft campaign, never a running one.",
    handover: "You review every name and every message, then launch.",
    output: ["Ranked prospects with reasons", "Connection note", "Two to three follow-ups"],
  },
  {
    n: "03",
    name: "Reply Agent",
    job: "Answers, and knows when not to",
    detail:
      "It classifies every reply before writing anything. Pricing, legal, security, anything negative, a request for a person, or simply low confidence all stop and wait for you. What it does answer, it answers only from your knowledge base.",
    handover: "Approve with one click, edit first, or answer it yourself.",
    output: ["Classified intent", "Drafted reply", "Times you are genuinely free"],
  },
  {
    n: "04",
    name: "You",
    job: "Close",
    detail:
      "Meetings arrive in your calendar with the conversation and the reasons the prospect matched. You spend the day in conversations rather than in a search box.",
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
              <h1>Four agents. Three handovers. One of them is you.</h1>
              <p className="lede prose">
                Each agent does one job and hands its work to the next. Every handover stops for a
                person, which is the difference between a tool you can leave running and one you
                cannot.
              </p>
            </header>
          </Reveal>

          <ol className="stack-5 agents">
            {AGENTS.map((agent) => (
              <li key={agent.n} className="card agent-row">
                <div className="agent-mark">
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
            <Link href="/login" className="btn large">
              Start 7-day free trial
            </Link>
            <Link href="/pricing" className="btn secondary large">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
