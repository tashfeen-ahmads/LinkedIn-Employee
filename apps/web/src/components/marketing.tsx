import Link from "next/link";
import { LINKEDIN_LIMITS } from "@le/shared";
import { Pipeline, ReplyGate, WarmupRamp } from "./diagrams";
import { Forecast } from "./forecast";
import { GateSimulator } from "./gate-simulator";
import { Reveal, Stagger, StaggerItem } from "./reveal";
import { Wordmark } from "./logo";
import { AgentTimeline } from "./agent-timeline";

/**
 * Marketing page sections. Structure mirrors docs/05-go-to-market.md section 2.
 * Proof numbers are deliberately absent until design partners produce real ones:
 * we do not ship a stat we have not measured.
 */

const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/linkedin-automation-limits", label: "Limits" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="container site-header-inner">
        <Link href="/" aria-label="LinkedIn Employee, home">
          <Wordmark />
        </Link>

        <nav className="site-nav" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="site-nav-link">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="site-header-actions">
          <Link href="/login" className="site-nav-link site-signin">
            Sign in
          </Link>
          <Link href="/login" className="btn small">
            Start free trial
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section className="section hero-wash">
      <div className="container hero-grid">
        <Reveal>
          <div className="stack-5">
            <p className="eyebrow">AI SDR for LinkedIn</p>
            <div className="stack-3">
              <h1>Your AI SDR for LinkedIn.</h1>
              <p className="lede prose">
                It finds your buyers, starts the conversation, and books the meeting into your
                calendar. You show up and close.
              </p>
            </div>
            <div className="cluster">
              <Link href="/login" className="btn large">
                Start 7-day free trial
              </Link>
              <a href="#how-it-works" className="btn secondary large">
                See how it works
              </a>
            </div>
            <p className="small subtle">
              Every reply is drafted for your approval until you decide to switch a campaign to
              autopilot.
            </p>
          </div>
        </Reveal>

        {/* The product's whole argument in one panel: it wrote the reply, and it
            stopped rather than sending it. Saying that is weaker than showing it. */}
        <Reveal delay={0.12}>
          <figure className="card raised hero-panel stack-4">
            <figcaption className="between" style={{ gap: "var(--space-2)" }}>
              <span className="eyebrow">Your inbox</span>
              <span className="pill warning">Pricing question</span>
            </figcaption>

            <div className="thread stack-3">
              <p className="small">
                <span className="subtle">Them: </span>
                Interesting — what does this actually cost for a team of six?
              </p>
              <p className="small draft">
                <span className="subtle">Drafted: </span>
                Happy to go through it properly — it depends on lanes rather than seats. Can I put
                fifteen minutes in the diary this week?
              </p>
            </div>

            <p className="tiny subtle">
              Held for you. Pricing, legal, anything negative and anything it is unsure about waits
              for a person, on every plan.
            </p>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    agent: "Strategy Agent",
    model: "Claude Opus, once per workspace",
    lead: "Tell it about your business once.",
    points: [
      "Share your website and LinkedIn page.",
      "It writes a Business Profile and three to five Customer Profiles, each with the Sales Navigator filters to execute it.",
    ],
  },
  {
    n: "02",
    agent: "Targeting Agent",
    model: "Claude Haiku for scoring, Opus for copy",
    lead: "Pick who to pursue.",
    points: [
      "It builds a ranked prospect list, showing the fit score and the intent signals behind every row.",
      "It writes the connection note and follow-ups, then hands you a launch-ready campaign.",
    ],
  },
  {
    n: "03",
    agent: "Reply Agent",
    model: "Claude Haiku to classify, Opus to write",
    lead: "Set the rules, then let it work.",
    points: [
      "Decide when it may answer and when a human must step in: pricing, legal, negative sentiment, anything it is unsure about.",
      "Connect your calendar so it can offer times you are actually free.",
    ],
  },
  {
    n: "04",
    agent: "You",
    model: "Judgement",
    lead: "Close.",
    points: [
      "Meetings land in your calendar with a one-page brief on who you are meeting and why they matched.",
      "You spend your day in conversations, not in a search box.",
    ],
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section band">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <p className="eyebrow">The four agents</p>
            <h2>Watch one campaign, day by day.</h2>
            <p className="lede prose">
              Each agent does one job and hands its work to the next. Step through a real one below — every beat names who acted, and the square markers are the moments
              nothing moves without you.
            </p>
          </div>
        </Reveal>

        <Reveal>
          <AgentTimeline />
        </Reveal>

        <Reveal>
          <Pipeline />
        </Reveal>

        <Stagger className="grid grid-2">
          {STEPS.map((step) => (
            <StaggerItem key={step.n}>
              <article className="card interactive stack-3" style={{ height: "100%" }}>
                <div className="cluster" style={{ alignItems: "baseline" }}>
                  <span className="eyebrow">{step.n}</span>
                  <h3>{step.agent}</h3>
                </div>
                <p style={{ fontWeight: 550 }}>{step.lead}</p>
                <ul className="muted small stack-2" style={{ margin: 0, paddingLeft: "1.05rem" }}>
                  {step.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <div className="cluster agent-io">
                  <span className="tiny subtle">Runs on</span>
                  <span className="pill plain">{step.model}</span>
                </div>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

/** The reply gate, given a section of its own because it is the whole argument. */
export function TheGate() {
  return (
    <section className="section">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <p className="eyebrow">The part that matters</p>
            <h2>It knows when to stop.</h2>
            <p className="lede prose">
              Anyone can draft a reply. The reason this can be left running is what it refuses to
              answer. Type something a prospect might send and watch which rule catches it — the
              opt-out check below is the product&rsquo;s own code, running here in your browser.
            </p>
          </div>
        </Reveal>
        <Reveal>
          <GateSimulator />
        </Reveal>

        <Reveal>
          <ReplyGate />
        </Reveal>
      </div>
    </section>
  );
}

/** The forecast, whose sliders run into the real caps. */
export function Volume() {
  return (
    <section className="section">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <p className="eyebrow">What a month looks like</p>
            <h2>Move the sliders until it hits the ceiling.</h2>
            <p className="lede prose">
              The daily one stops at {LINKEDIN_LIMITS.invitesPerDayMax} because the product stops
              there, and the weekly ceiling clamps the total underneath it. You will find the limit by
              dragging into it, which is a better way to learn it than reading a paragraph.
            </p>
          </div>
        </Reveal>
        <Reveal>
          <Forecast />
        </Reveal>
      </div>
    </section>
  );
}

/** The caps, shown rather than claimed. */
export function Safety() {
  return (
    <section className="section band">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <p className="eyebrow">Account safety</p>
            <h2>Slow on purpose, for as long as it takes.</h2>
            <p className="lede prose">
              The failure that ends a pipeline is not a weak campaign — it is losing the account it
              runs on. So a new account starts at {LINKEDIN_LIMITS.invitesPerDayStart} invitations a
              day and takes {Math.round(LINKEDIN_LIMITS.warmupDays / 7)} weeks to reach{" "}
              {LINKEDIN_LIMITS.invitesPerDayMax}, and never passes {LINKEDIN_LIMITS.invitesPerWeek} in
              a week however many campaigns are running.
            </p>
          </div>
        </Reveal>

        <Reveal>
          <WarmupRamp />
        </Reveal>

        <Stagger className="grid grid-3">
          {SAFETY_FACTS.map((fact) => (
            <StaggerItem key={fact.label}>
              <div className="card tight stat" style={{ height: "100%" }}>
                <span className="stat-label">{fact.label}</span>
                <span className="stat-value">{fact.value}</span>
                <span className="stat-note">{fact.note}</span>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <Reveal>
          <p className="small subtle prose">
            Every one of these is read from a single constants file that the sender checks before each
            action, and a campaign may only ask for less.{" "}
            <Link href="/linkedin-automation-limits">Where the numbers come from</Link>.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const SAFETY_FACTS = [
  {
    label: "Gap between actions",
    value: "2–9 min",
    note: "Randomised, so it never looks like a scheduler",
  },
  {
    label: "Checked before every send",
    value: "Twice",
    note: "At planning, and again in the second before it leaves",
  },
  {
    label: "Pauses on a warning",
    value: "Instantly",
    note: "And resumes by itself once the account is healthy",
  },
];

const SIGNALS = [
  { label: "Started a new role", detail: "Budgets and tooling get revisited", points: 30, weight: 100 },
  { label: "Engaged with your content", detail: "Liked or commented on a post", points: 25, weight: 83 },
  { label: "Viewed your profile", detail: "Already curious about you", points: 25, weight: 83 },
  { label: "Company is hiring", detail: "Open roles in the function you sell into", points: 20, weight: 67 },
  { label: "Recent funding", detail: "New capital, new spending decisions", points: 20, weight: 67 },
  { label: "Follows your company", detail: "Warm before you arrive", points: 15, weight: 50 },
];

export function Signals() {
  return (
    <section id="signals" className="section">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <p className="eyebrow">Why this lead</p>
            <h2>Every score shows its working.</h2>
            <p className="lede prose">
              Other tools print &ldquo;high intent&rdquo; and move on. A score you cannot interrogate
              is a score you cannot correct — so each prospect carries the signals that produced it,
              with the weight each one contributed.
            </p>
          </div>
        </Reveal>

        <Reveal>
          <div className="card scored stack-4">
            <div className="between">
              <div className="stack-1">
                <strong>Dmitri Kovač</strong>
                <span className="small muted">Head of RevOps · Halstead Freight · 120 staff</span>
              </div>
              <div className="cluster">
                <span className="pill accent">Fit 92</span>
                <span className="pill positive">Intent 70</span>
              </div>
            </div>

            <ul className="signal-list">
              {SIGNALS.map((signal) => (
                <li key={signal.label}>
                  <span className="signal-bar" style={{ ["--weight" as string]: `${signal.weight}%` }} />
                  <span className="small">{signal.label}</span>
                  <span className="tiny subtle">{signal.detail}</span>
                  <span className="tiny mono">+{signal.points}</span>
                </li>
              ))}
            </ul>

            <p className="tiny subtle">
              Fit decides whether to contact at all. Intent decides who first, and decays to nothing
              over ninety days — a funding round from last spring is not a reason to message anyone
              today.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const EXTRAS = [
  {
    title: "Built for teams",
    body: "Nobody shares a LinkedIn login. Each rep connects their own account, and no two reps ever message the same person.",
  },
  {
    title: "Your CRM stays clean",
    body: "HubSpot and Salesforce sync contacts, activity and booked meetings. Zapier and webhooks cover everything else.",
  },
  {
    title: "Safe by default",
    body: "Conservative daily caps that ramp as the account warms up, randomized timing, and an automatic pause the moment LinkedIn pushes back.",
  },
];

export function Extras() {
  return (
    <section className="section band">
      <div className="container stack-6">
        <h2>What comes with it.</h2>
        <Stagger className="grid grid-2">
          {EXTRAS.map((extra) => (
            <StaggerItem key={extra.title}>
              <article className="card interactive stack-2" style={{ height: "100%" }}>
                <h3>{extra.title}</h3>
                <p className="muted small">{extra.body}</p>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

const PLANS = [
  {
    name: "Solo",
    price: "$149",
    features: ["One seat", "All four agents", "Replies drafted for your approval", "CRM via Zapier"],
    highlight: false,
  },
  {
    name: "Pro",
    price: "$249",
    features: [
      "Everything in Solo",
      "Autopilot replies, per campaign",
      "Intent signals on every lead",
      "Native HubSpot and Salesforce",
    ],
    highlight: true,
  },
  {
    name: "Teams",
    price: "$199",
    features: [
      "Everything in Pro, three seats or more",
      "Shared exclusion lists",
      "Per-rep funnel reporting",
      "Dedicated account manager",
    ],
    highlight: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="container stack-6">
        <div className="stack-3">
          <p className="eyebrow">Pricing</p>
          <h2>Per seat, per month.</h2>
          <p className="lede prose">Seven-day free trial on every plan. No card to start.</p>
        </div>

        <div className="grid grid-2">
          {PLANS.map((plan) => (
            <article key={plan.name} className={`card stack-4 plan${plan.highlight ? " plan-featured" : ""}`}>
              <div className="between">
                <h3>{plan.name}</h3>
                {plan.highlight ? <span className="pill accent">Most popular</span> : null}
              </div>

              <p className="price">
                <span className="mono">{plan.price}</span>
                <span className="small muted"> / seat / mo</span>
              </p>

              <ul className="small muted stack-2" style={{ margin: 0, paddingLeft: "1.05rem" }}>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <Link href="/login" className={`btn${plan.highlight ? "" : " secondary"} block`}>
                Start free trial
              </Link>
            </article>
          ))}
        </div>

        <p className="small subtle prose">
          A LinkedIn Sales Navigator seat is recommended on Pro and Teams and is billed by LinkedIn,
          not by us.
        </p>
      </div>
    </section>
  );
}

export const FAQ_ITEMS = [
  {
    q: "Is this safe for my LinkedIn account?",
    a: "It is the constraint we designed around. Sending starts at ten connection requests a day and ramps to thirty-five over five weeks, never exceeds one hundred a week, and is spread randomly across your working hours. If LinkedIn shows a warning, a captcha, or an unusual login screen, the account pauses itself and tells you. No tool can promise zero risk — LinkedIn's user agreement prohibits automation — so we tell you that plainly and keep the volume well under the line.",
  },
  {
    q: "Do I need Sales Navigator?",
    a: "It gives the Targeting Agent much better filters, so we recommend it on Pro and Teams. Solo works without one.",
  },
  {
    q: "Can I approve every message?",
    a: "Yes, and that is the default. The Reply Agent drafts, you approve with one click. Autopilot is a per-campaign switch you flip once you trust it.",
  },
  {
    q: "What happens when a prospect asks something hard?",
    a: "It stops and hands the conversation to you. Pricing, legal or security questions, anything negative, a request to speak to a person, or simply low confidence: all of them park the draft in your inbox instead of sending it.",
  },
];

export function Faq() {
  return (
    <section className="section band">
      <div className="narrow stack-5">
        <h2>Questions worth asking</h2>
        <div className="faq">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p className="muted small">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The last thing on every page: one ask, stated plainly. */
export function ClosingCta() {
  return (
    <section className="closing">
      <div className="container closing-inner">
        <div className="stack-3">
          <h2>Start with ten invitations a day.</h2>
          <p className="lede prose">
            Seven days free, no card. Your first campaign runs in approval mode, so nothing reaches
            anyone until you have read it.
          </p>
        </div>
        <div className="cluster">
          <Link href="/login" className="btn large">
            Start free trial
          </Link>
          <Link href="/how-it-works" className="btn secondary large">
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/security", label: "Security and data" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/linkedin-automation-limits", label: "LinkedIn limits in 2026" },
      { href: "/about", label: "Why it is built this way" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container stack-6">
        <div className="footer-grid">
          <div className="stack-3">
            <Link href="/" aria-label="LinkedIn Employee, home">
              <Wordmark />
            </Link>
            <p className="small muted" style={{ maxWidth: "32ch" }}>
              An AI SDR that works inside the limits that keep a LinkedIn account alive.
            </p>
            <p className="tiny subtle">
              Built in the open. Every cap on this site is read from the code that enforces it.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.title} className="footer-column" aria-label={column.title}>
              <span className="eyebrow">{column.title}</span>
              {column.links.map((link) => (
                <Link key={link.href} href={link.href} className="footer-link">
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>

        <hr className="divider" />

        <div className="footer-base">
          <span className="tiny subtle">© {new Date().getFullYear()} LinkedIn Employee</span>
          <span className="tiny subtle">
            Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of its owner, and
            automated access is against their user agreement — which is why the limits on this site
            are what they are.
          </span>
        </div>
      </div>
    </footer>
  );
}
