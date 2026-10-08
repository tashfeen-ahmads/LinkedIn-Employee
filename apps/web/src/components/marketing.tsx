import Link from "next/link";
import { PlatformDiagram } from "./platform-diagram";
import { SiteMenu, SiteNav, UnlessOn } from "./site-nav";
import { Sequence, sequenceFor } from "@/components/sequence";
import { BRAND, LINKEDIN_LIMITS } from "@le/shared";
import { SITE } from "@/lib/site";
import { ReplyGate, WarmupRamp } from "./diagrams";
import { Forecast } from "./forecast";
import { GateSimulator } from "./gate-simulator";
import { ProductFilm } from "./product-film";
import { Reveal, Stagger, StaggerItem } from "./reveal";
import { Wordmark } from "./logo";
import { AgentTimeline } from "./agent-timeline";
import { TeamStage } from "./team-stage";
import { NORA } from "@/lib/team";

/**
 * Marketing page sections. Structure mirrors docs/05-go-to-market.md section 2.
 * Proof numbers are deliberately absent until design partners produce real ones:
 * we do not ship a stat we have not measured.
 */

/*
 * No "Pricing" link: the product is free for everyone for now, and a nav item
 * leading to a page that says so is a detour. The team is what the page is
 * about, so it takes the slot.
 */
const NAV_LINKS = [
  { href: "/#team", label: "The team" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/linkedin-automation-limits", label: "Limits" },
  { href: "/security", label: "Security" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="container site-header-inner">
        <Link href="/" className="site-home" aria-label={`${BRAND.name}, home`}>
          <Wordmark />
        </Link>

        <SiteNav links={NAV_LINKS} />

        {/*
          Sign in and sign up, which are the two things a header is for.

          The filled button used to point at /login — so the one control
          aimed at somebody who has never been here before opened a form
          asking for a password they do not have. Signing up is what they do.
        */}
        <div className="site-header-actions">
          <Link href={`${SITE.app}/login`} className="site-nav-link site-signin">
            Sign in
          </Link>
          <Link href={`${SITE.app}/signup`} className="btn small">
            Sign up free
          </Link>
          {/* Below 900px the nav is hidden and below 640px so is Sign in; the
              menu carries both, so neither is ever out of reach. */}
          <SiteMenu links={NAV_LINKS} signInHref={`${SITE.app}/login`} />
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section className="section hero-wash">
      {/*
        Centred, with the product underneath rather than beside: the sentence
        that has to do the work is the widest thing on the page, and the
        diagram under it is the evidence.

        Three text elements and one picture. The hero used to carry an
        announcement pill, a seventy-five-word lede, a tagline under the
        buttons, the diagram *and* a mock inbox panel whose "what does this
        cost?" exchange the film tells again further down. A first screen that
        says five things is read as saying none of them.
      */}
      <div className="container hero-grid">
        <Reveal>
          <div className="stack-5 hero-copy">
            <div className="stack-3">
              {/*
                The outcome, and nothing but the outcome. The safety claim is
                in the lede on purpose: a headline that mentions risk puts the
                risk in the reader's head before the reward.
              */}
              <h1>
                Meetings and leads created{" "}
                <span className="headline-accent">while you sleep.</span>
              </h1>
              <p className="lede prose">
                {NORA} and a team of four find your buyers, write to each one, answer the replies
                and book the meeting, inside the daily limits LinkedIn actually watches.
              </p>
            </div>
            <div className="cluster">
              <Link href={`${SITE.app}/signup`} className="btn large">
                Sign up free
              </Link>
              <a href="#team" className="btn secondary large">
                Meet the team
              </a>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <PlatformDiagram />
        </Reveal>
      </div>

      {/*
        The four rules, immediately under the hero: the argument this product
        wins on, where somebody deciding whether to keep scrolling reaches it.
        Facts the product enforces in code, not claims.
      */}
      <div className="container">
        <ul className="proof">
          {PROOF.map((item) => (
            <li key={item.label}>
              <span className="proof-value">{item.value}</span>
              <span className="proof-label">{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * What the hero's strip says. Every line of it is enforced rather than
 * promised, which is the only kind of claim worth putting under a headline,
 * and the ramp is read from the constants the limiter obeys.
 */
const PROOF = [
  { value: "Every reply", label: "drafted for you to read before it sends, until you say otherwise" },
  {
    value: `${LINKEDIN_LIMITS.invitesPerDayStart} → ${LINKEDIN_LIMITS.invitesPerDayMax} a day`,
    label: "a warm-up ramp that starts at your first send, never at signup",
  },
  { value: "Spread", label: "a day's invitations paced across your working hours, never in a burst" },
  { value: "Never twice", label: "nobody your workspace has contacted is ever contacted again" },
] as const;

/**
 * The film, in a band of its own directly under the hero.
 *
 * Under it rather than inside it on purpose. The hero's job is one sentence and
 * one button, and a looping demo competing with them for the same eye halves
 * both; the film's job is to answer "what is this, actually", which is the
 * question somebody has the moment after they finish the headline.
 */
export function Film() {
  return (
    <section className="section">
      <div className="container stack-5">
        {/*
          The hero's diagram makes the "five stages, in this order" claim; this
          band is the evidence for it rather than a restatement: what each
          stage actually hands over, on screen.
        */}
        <h2>Five stages, and what each one hands over.</h2>
        <ProductFilm />
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section band">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <h2>Watch one campaign, day by day.</h2>
            <p className="lede prose">
              Each teammate does one job and hands its work to the next. Step through a real one
              below: every beat names who acted, and the square markers are the moments nothing
              moves without you.
            </p>
          </div>
        </Reveal>

        {/* The timeline alone. A pipeline diagram used to sit under it, the
            fifth drawing of the same five stages on this page, and it said
            "three agents" on a page introducing four. */}
        <Reveal>
          <AgentTimeline />
        </Reveal>
      </div>
    </section>
  );
}

/**
 * What a prospect actually receives, on the page that has to sell it.
 *
 * The competitors' whole proposition is the drag-and-drop canvas: "look how
 * easy the sequence is to assemble". It is the most effective thing on their
 * sites and it was the one thing of ours buried behind a login — a visitor had
 * to take on faith that there was a sequence at all.
 *
 * The same component the campaign screen draws, with a worked example in it.
 * Not a second copy dressed for marketing: a landing page that renders its own
 * idealised version of a product screen is how a site comes to promise
 * something the product does not do, and this one is rendered from the same
 * function with the same rules, including the two steps a person may not move.
 *
 * And it is a better argument than a canvas. Their picture shows how easy it is
 * to build a sequence; this one shows what a stranger reads, which is the thing
 * the buyer is actually nervous about.
 */
export function TheSequence() {
  return (
    <section className="section" id="the-sequence">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3 measure">
            <p className="eyebrow section-mark">What they receive</p>
            <h2>A conversation, not a blast.</h2>
            <p className="lede prose">
              Every campaign runs the same shape. You write the words. The timing is a product
              rule, because the timing is what gets accounts restricted.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          {/* A plain card. The first attempt wrapped this in `.app` to borrow
              the application's styles, which put the whole sequence inside the
              shell grid's 240px sidebar track — `.app` is a layout, not a
              theme. The component's own rules are unscoped instead, because it
              shares its names with nothing. */}
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
                    message: "Thanks for connecting, Priya. Is partner referrals something you own there, or does it sit with marketing?",
                  },
                  {
                    step_number: 2,
                    delay_days: 4,
                    message: "No worries if the timing is off. Here is the short version if it is ever useful: {{cta_link}}",
                  },
                ],
              })}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function TheGate() {
  return (
    <section className="section">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <h2>It knows when to stop.</h2>
            <p className="lede prose">
              Anyone can draft a reply. The reason this can be left running is what it refuses to
              answer. Type something a prospect might send and watch which rule catches it: the
              opt-out check below is the product&rsquo;s own code, running in your browser.
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
            <p className="eyebrow section-mark">Account safety</p>
            <h2>Slow on purpose, for as long as it takes.</h2>
            <p className="lede prose">
              The failure that ends a pipeline is not a weak campaign. It is losing the account it
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

/** The floor between two actions, from the constant the limiter reads. */
const MIN_GAP_MINUTES = Math.round(LINKEDIN_LIMITS.minGapMs / 60_000);

const SAFETY_FACTS = [
  {
    label: "Gap between actions",
    value: `${MIN_GAP_MINUTES} min or more`,
    note: "Randomised and spread across your working hours, so it never looks like a scheduler",
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
            <h2>Every score shows its working.</h2>
            <p className="lede prose">
              Other tools print &ldquo;high intent&rdquo; and move on. A score you cannot interrogate
              is a score you cannot correct, so each prospect carries the signals that produced it
              and the weight each one contributed.
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

            <p className="tiny subtle prose">
              Fit decides whether to contact at all. Intent decides who first, and decays to nothing
              over ninety days. A funding round from last spring is not a reason to message anyone
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
              <article className="card interactive" style={{ height: "100%" }}>
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

/** Said once and reused, so the hero, the band and /pricing cannot drift apart. */
export const FREE_LINE = "Free for now, for everyone.";

/**
 * Where the plans used to be.
 *
 * The product is free for everyone while it is being built in the open, so
 * the three price cards, the per-seat line and the comparison arguing for a
 * price are gone rather than greyed out: a crossed-out price reads as a sale,
 * and a sale is a promise about a later price nobody has decided.
 *
 * `standalone` decides the heading level, as it did for the plans: one section
 * under the hero's `<h1>` on the home page, the whole of /pricing there. It
 * also decides the button. On the home page the closing band follows within a
 * screen with the same ask, and two identical pairs of buttons that close
 * together read as one page repeating itself.
 */
export function FreeForNow({ standalone = false }: { standalone?: boolean } = {}) {
  const Heading = standalone ? "h1" : "h2";
  return (
    <section id="free" className="section">
      <div className="container">
        <div className="card raised free-card">
          <div className="stack-3">
            <p className="eyebrow section-mark">What it costs</p>
            <Heading>{FREE_LINE}</Heading>
            <p className="lede prose">
              No plans to compare and no card to enter. {NORA} and the whole team, for every
              workspace.
            </p>
          </div>
          {standalone ? (
            <div className="cluster">
              <Link href={`${SITE.app}/signup`} className="btn large">
                Sign up free
              </Link>
            </div>
          ) : null}
          <p className="small subtle prose">
            If that ever changes, you will hear it from us well before it does, and nothing you have
            built here is held back to make the point.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * NORA and her four, near the top of the page that has to explain them.
 *
 * Every name is a job the product already does — the mapping to the real code
 * is written down in `lib/team.ts` — and every bullet is read from the same
 * definition the dashboard's team panel uses, so the site cannot introduce a
 * teammate the product does not have.
 */
export function MeetTheTeam() {
  return (
    <section id="team" className="section crew-section">
      <div className="container stack-6">
        <Reveal>
          <div className="stack-3">
            <p className="eyebrow section-mark">Meet the team</p>
            <h2>One assistant. Four specialists. Your pipeline, handled.</h2>
            <p className="lede prose">
              {NORA} runs your dashboard and leads four AI employees. Sage works out who to go
              after, Scout finds them, Quinn writes to each one, and Reese sends, answers and
              books. Each hands the work to the next and stops where a decision is yours.
            </p>
          </div>
        </Reveal>
        <TeamStage />
        <p className="small subtle prose">
          Names for the jobs, not people pretending to be people: every message still goes out
          under your own name, in your own voice, from your own LinkedIn account.
        </p>
      </div>
    </section>
  );
}

export const FAQ_ITEMS = [
  {
    q: "What does it cost?",
    a: "Nothing for now, for everyone. Sign up and start right away: no plan to choose and no card to enter. If that changes, you will hear it from us well before it does.",
  },
  {
    q: "Is this safe for my LinkedIn account?",
    a: `It is the constraint we designed around. Sending starts at ${LINKEDIN_LIMITS.invitesPerDayStart} connection requests a day and ramps to ${LINKEDIN_LIMITS.invitesPerDayMax} over ${Math.round(LINKEDIN_LIMITS.warmupDays / 7)} weeks, never exceeds ${LINKEDIN_LIMITS.invitesPerWeek} a week, and is spread across your working hours. If LinkedIn shows a warning, a captcha or an unusual login screen, the account pauses itself and tells you. No tool can promise zero risk, because LinkedIn's user agreement prohibits automation, so we say that plainly and keep the volume well under the line.`,
  },
  {
    q: "Do I need Sales Navigator?",
    a: "No. Scout works with any LinkedIn account. Sales Navigator, which LinkedIn sells separately, lets it search more precisely by seniority and company size, and where a filter cannot be applied, the campaign says so before you launch.",
  },
  {
    q: "Can I approve every message?",
    a: "Yes, and that is the default: Reese drafts, you approve with one click. Autopilot is a switch you flip once you trust it, and then it answers and books on its own. Two things always wait for you either way: somebody who asks to speak to a person, and a message the agent did not understand.",
  },
  {
    q: "What happens when a prospect asks something hard?",
    a: "By default it stops and hands the conversation to you. Pricing, legal or security questions, anything negative, a request to speak to a person, or simply low confidence: all of them park the draft in your inbox instead of sending it.",
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

/**
 * The last thing on every page: one ask, stated plainly.
 *
 * `secondary` is the quieter second button. It is hidden on the page it links
 * to, because the layout renders this band everywhere and a "See how it works"
 * button at the foot of /how-it-works was a link to the page already open.
 * Pass `null` to drop it altogether.
 */
export function ClosingCta({
  secondary = { href: "/how-it-works", label: "See how it works" },
}: { secondary?: { href: string; label: string } | null } = {}) {
  return (
    <section className="closing">
      <div className="container closing-inner">
        <div className="stack-3">
          <h2>Start with {LINKEDIN_LIMITS.invitesPerDayStart} invitations a day.</h2>
          <p className="lede prose">
            {FREE_LINE} Your first campaign runs in approval mode, so nothing reaches anyone until
            you have read it.
          </p>
        </div>
        <div className="cluster">
          <Link href={`${SITE.app}/signup`} className="btn large">
            Sign up free
          </Link>
          {secondary ? (
            <UnlessOn path={secondary.href}>
              <Link href={secondary.href} className="btn secondary large">
                {secondary.label}
              </Link>
            </UnlessOn>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#team", label: `Meet ${NORA} and the team` },
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Free for now" },
      { href: "/security", label: "Security and data" },
      // Absolute: the dashboard is another host, and a relative /login here
      // lands on a marketing page that cannot hold a session.
      { href: `${SITE.app}/login`, label: "Sign in" },
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
            <Link href="/" aria-label={`${BRAND.name}, home`}>
              <Wordmark />
            </Link>
            <p className="small muted measure-short">
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
          <span className="tiny subtle">© {new Date().getFullYear()} {BRAND.full}</span>
          <span className="tiny subtle">
            Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of its owner, and
            automated access is against their user agreement, which is why the limits on this site
            are what they are.
          </span>
        </div>
      </div>
    </footer>
  );
}
