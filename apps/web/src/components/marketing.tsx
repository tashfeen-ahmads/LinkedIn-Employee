import Link from "next/link";
import { Reveal } from "./reveal";

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
      <div className="container between" style={{ height: 64, flexWrap: "nowrap" }}>
        <Link href="/" className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          LinkedIn&nbsp;Employee
        </Link>
        <nav className="cluster-3 small" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="muted site-nav-link">
              {link.label}
            </Link>
          ))}
          <Link href="/login" className="btn small">
            Start free trial
          </Link>
        </nav>
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
    lead: "Tell it about your business once.",
    points: [
      "Share your website and LinkedIn page.",
      "It writes a Business Profile and three to five Customer Profiles, each with the Sales Navigator filters to execute it.",
    ],
  },
  {
    n: "02",
    agent: "Targeting Agent",
    lead: "Pick who to pursue.",
    points: [
      "It builds a ranked prospect list, showing the fit score and the intent signals behind every row.",
      "It writes the connection note and follow-ups, then hands you a launch-ready campaign.",
    ],
  },
  {
    n: "03",
    agent: "Reply Agent",
    lead: "Set the rules, then let it work.",
    points: [
      "Decide when it may answer and when a human must step in: pricing, legal, negative sentiment, anything it is unsure about.",
      "Connect your calendar so it can offer times you are actually free.",
    ],
  },
  {
    n: "04",
    agent: "You",
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
        <div className="stack-3">
          <p className="eyebrow">How it works</p>
          <h2>Four agents, one job each.</h2>
          <p className="lede prose">
            Each one hands its work to the next. You stay in control at every handover.
          </p>
        </div>

        {/* Numbered because it is a real sequence: agent two cannot run until a
            human has approved what agent one wrote. */}
        <ol className="grid grid-2 steps">
          {STEPS.map((step) => (
            <li key={step.n} className="card interactive stack-3">
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
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const SIGNALS = [
  { label: "Started a new role", detail: "In the last 90 days, when budgets and tooling get revisited." },
  { label: "Company is hiring", detail: "Open roles in the function you sell into." },
  { label: "Recent funding", detail: "New capital, new spending decisions." },
  { label: "Engaged with your content", detail: "Liked or commented on a post of yours." },
  { label: "Viewed your profile", detail: "Already curious about you." },
  { label: "Posted recently", detail: "Active on the platform, so a message gets seen." },
];

export function Signals() {
  return (
    <section id="signals" className="section">
      <div className="container stack-6">
        <div className="stack-3">
          <p className="eyebrow">The difference</p>
          <h2>You see why every lead was chosen.</h2>
          <p className="lede prose">
            Other tools say &ldquo;high intent&rdquo; and leave it there. Every prospect here carries
            the signals that put them on your list, so you can argue with the ranking and retrain it.
          </p>
        </div>

        <div className="grid grid-3">
          {SIGNALS.map((signal) => (
            <div key={signal.label} className="card interactive tight stack-2">
              <strong className="small">{signal.label}</strong>
              <p className="muted tiny">{signal.detail}</p>
            </div>
          ))}
        </div>
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
        <div className="grid grid-2">
          {EXTRAS.map((extra) => (
            <article key={extra.title} className="card interactive stack-2">
              <h3>{extra.title}</h3>
              <p className="muted small">{extra.body}</p>
            </article>
          ))}
        </div>
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

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container stack-5">
        <div className="footer-grid">
          <div className="stack-2">
            <Link href="/" className="wordmark">
              <span className="wordmark-dot" aria-hidden="true" />
              LinkedIn&nbsp;Employee
            </Link>
            <p className="small subtle" style={{ maxWidth: "34ch" }}>
              An AI SDR that works inside limits that keep your account alive.
            </p>
          </div>

          <nav className="stack-2 small" aria-label="Product">
            <span className="eyebrow">Product</span>
            <Link href="/how-it-works" className="muted">
              How it works
            </Link>
            <Link href="/pricing" className="muted">
              Pricing
            </Link>
            <Link href="/security" className="muted">
              Security
            </Link>
          </nav>

          <nav className="stack-2 small" aria-label="Learn">
            <span className="eyebrow">Learn</span>
            <Link href="/linkedin-automation-limits" className="muted">
              LinkedIn limits 2026
            </Link>
            <Link href="/about" className="muted">
              About
            </Link>
          </nav>
        </div>

        <hr className="divider" />

        <div className="between">
          <span className="tiny subtle">© {new Date().getFullYear()} LinkedIn Employee</span>
          <span className="tiny subtle">
            Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of its owner.
          </span>
        </div>
      </div>
    </footer>
  );
}
