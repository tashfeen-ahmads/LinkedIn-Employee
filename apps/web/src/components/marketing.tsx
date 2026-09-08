import Link from "next/link";

/**
 * Marketing page sections. Structure mirrors docs/05-go-to-market.md section 2.
 * Proof numbers are deliberately absent until design partners produce real ones:
 * we do not ship a stat we have not measured.
 */

export function SiteHeader() {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--border)",
        position: "sticky",
        top: 0,
        background: "var(--bg)",
        zIndex: 10,
      }}
    >
      <div
        className="container"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}
      >
        <Link href="/" style={{ fontWeight: 640, letterSpacing: "-0.02em" }}>
          LinkedIn&nbsp;Employee
        </Link>
        <nav style={{ display: "flex", alignItems: "center", gap: "1.5rem", fontSize: "0.92rem" }}>
          <a href="#how-it-works" className="muted">
            How it works
          </a>
          <a href="#signals" className="muted">
            Intent signals
          </a>
          <a href="#pricing" className="muted">
            Pricing
          </a>
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
    <section style={{ padding: "5rem 0 3.5rem" }}>
      <div className="container" style={{ maxWidth: 820 }}>
        <span className="pill accent">AI SDR for LinkedIn</span>
        <h1 style={{ marginTop: "1rem" }}>Your AI SDR for LinkedIn.</h1>
        <p style={{ fontSize: "1.2rem", color: "var(--text-muted)", maxWidth: 620 }}>
          It finds your buyers, starts the conversation, and books the meeting into your calendar. You
          show up and close.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.75rem" }}>
          <Link href="/login" className="btn">
            Start 7-day free trial
          </Link>
          <a href="#how-it-works" className="btn secondary">
            See how it works
          </a>
        </div>
        <p className="small muted" style={{ marginTop: "1.25rem" }}>
          Every reply is drafted for your approval until you decide to switch a campaign to autopilot.
        </p>
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
    <section id="how-it-works" style={{ padding: "4rem 0", background: "var(--surface)" }}>
      <div className="container">
        <span className="pill">How it works</span>
        <h2 style={{ marginTop: "0.9rem" }}>Four agents, one job each.</h2>
        <p className="muted" style={{ maxWidth: 560 }}>
          Each one hands its work to the next. You stay in control at every handover.
        </p>
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(255px, 1fr))",
            marginTop: "2rem",
          }}
        >
          {STEPS.map((step) => (
            <article key={step.n} className="card">
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
                <span className="mono muted small">{step.n}</span>
                <h3 style={{ margin: 0 }}>{step.agent}</h3>
              </div>
              <p style={{ fontWeight: 560, margin: "0.75rem 0 0.5rem" }}>{step.lead}</p>
              <ul className="muted small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {step.points.map((point) => (
                  <li key={point} style={{ marginBottom: "0.4rem" }}>
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
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
    <section id="signals" style={{ padding: "4rem 0" }}>
      <div className="container">
        <span className="pill">The difference</span>
        <h2 style={{ marginTop: "0.9rem" }}>You see why every lead was chosen.</h2>
        <p className="muted" style={{ maxWidth: 620 }}>
          Other tools say &ldquo;high intent&rdquo; and leave it there. Every prospect here carries the
          signals that put them on your list, so you can argue with the ranking and retrain it.
        </p>
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            marginTop: "1.75rem",
          }}
        >
          {SIGNALS.map((signal) => (
            <div key={signal.label} className="card">
              <strong style={{ fontSize: "0.95rem" }}>{signal.label}</strong>
              <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
                {signal.detail}
              </p>
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
    <section style={{ padding: "4rem 0", background: "var(--surface)" }}>
      <div className="container">
        <h2>What comes with it.</h2>
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            marginTop: "1.75rem",
          }}
        >
          {EXTRAS.map((extra) => (
            <article key={extra.title} className="card">
              <h3>{extra.title}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {extra.body}
              </p>
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
    <section id="pricing" style={{ padding: "4rem 0" }}>
      <div className="container">
        <h2>Pricing</h2>
        <p className="muted">Per seat, per month. Seven-day free trial on every plan.</p>
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            marginTop: "1.75rem",
          }}
        >
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className="card"
              style={plan.highlight ? { borderColor: "var(--accent)", boxShadow: "var(--shadow)" } : undefined}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>{plan.name}</h3>
                {plan.highlight ? <span className="pill accent">Most popular</span> : null}
              </div>
              <p style={{ fontSize: "2rem", fontWeight: 660, margin: "0.6rem 0 0.2rem" }}>
                {plan.price}
                <span className="muted" style={{ fontSize: "0.95rem", fontWeight: 400 }}>
                  {" "}
                  / seat / mo
                </span>
              </p>
              <ul className="small" style={{ margin: "1rem 0 1.25rem", paddingLeft: "1.1rem" }}>
                {plan.features.map((feature) => (
                  <li key={feature} style={{ marginBottom: "0.35rem" }}>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link href="/login" className="btn secondary small">
                Start free trial
              </Link>
            </article>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: "1.25rem" }}>
          A LinkedIn Sales Navigator seat is recommended on Pro and Teams and is billed by LinkedIn, not
          by us.
        </p>
      </div>
    </section>
  );
}

const FAQ = [
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
    <section style={{ padding: "4rem 0", background: "var(--surface)" }}>
      <div className="narrow">
        <h2>Questions worth asking</h2>
        <div style={{ marginTop: "1.5rem" }}>
          {FAQ.map((item) => (
            <details
              key={item.q}
              style={{ borderBottom: "1px solid var(--border)", padding: "1rem 0" }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 560 }}>{item.q}</summary>
              <p className="muted" style={{ margin: "0.75rem 0 0" }}>
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer style={{ borderTop: "1px solid var(--border)", padding: "2.5rem 0" }}>
      <div
        className="container"
        style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}
      >
        <span className="small muted">© {new Date().getFullYear()} LinkedIn Employee</span>
        <span className="small muted">
          Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of its owner.
        </span>
      </div>
    </footer>
  );
}
