import Link from "next/link";
import type { ReactNode } from "react";
import { SiteMenu, SiteNav } from "./site-nav";
import { BRAND, FREE_NOTES_PER_MONTH, POWERED_BY, LINKEDIN_LIMITS, RAMP_SENTENCE, alwaysHoldsSentence } from "@le/shared";
import { SITE } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/plans";
import { Wordmark } from "./logo";

/*
 * The frame every public page wears: header, the inner pages' hero, the FAQ,
 * the closing band and the footer. The home page's own sections are in
 * `home.tsx`.
 *
 * Proof numbers are deliberately absent until design partners produce real
 * ones: we do not ship a stat we have not measured.
 */

/*
 * Five links, one line. Safety goes to the limits page, because that page is
 * where the numbers are, and Pricing is there because "what does it cost" is
 * the question people ask before any other. `also` names the other pages a
 * link stands for, so somebody reading /security still sees which part of the
 * site they are in.
 */
const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/linkedin-automation-limits", label: "Safety", also: ["/security"] },
  { href: "/pricing", label: "Pricing" },
  { href: "/guides", label: "Guides" },
  { href: "/about", label: "About" },
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
          Sign in and sign up, which are the two things a header is for. The
          filled button is for somebody who has never been here, so it signs
          them up rather than asking for a password they do not have.
        */}
        <div className="site-header-actions">
          <Link href={`${SITE.app}/login`} className="site-nav-link site-signin">
            Sign in
          </Link>
          <Link href={`${SITE.app}/signup`} className="btn">
            Start free trial
          </Link>
          {/* Below 900px the nav is hidden and below 480px so is Sign in; the
              menu carries both, so neither is ever out of reach. */}
          <SiteMenu links={NAV_LINKS} signInHref={`${SITE.app}/login`} />
        </div>
      </div>
    </header>
  );
}

/**
 * The opening of every inner page. Smaller than the home page's hero and the
 * same on every page, so moving between them reads as one site. The page
 * writes its own `<h1>` as the child: the heading belongs to the page, and the
 * structure test counts it there.
 */
export function PageHero({
  children,
  lede,
  crumb,
  actions,
  aside,
}: {
  children: ReactNode;
  lede?: ReactNode;
  crumb?: string;
  actions?: ReactNode;
  /** A picture or a short fact list beside the words, so the hero is not half empty. */
  aside?: ReactNode;
}) {
  const copy = (
    <div className={aside ? "mk-page-hero-inner" : "container mk-page-hero-inner"}>
      {crumb ? (
        <nav className="mk-crumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{crumb}</span>
        </nav>
      ) : null}
      {children}
      {lede ? <div className="mk-page-lede">{lede}</div> : null}
      {actions ? <div className="mk-actions">{actions}</div> : null}
    </div>
  );
  return (
    <section className="mk-page-hero hero-wash">
      {aside ? (
        <div className="container mk-page-hero-split">
          {copy}
          <div className="mk-page-hero-aside">{aside}</div>
        </div>
      ) : (
        copy
      )}
    </section>
  );
}

/**
 * A short card of facts beside an inner page's opening: the numbers or the
 * answers somebody came for, each a label and a value, read from the same
 * constants the product runs on wherever there is a number.
 */
export function Glance({
  title,
  items,
  foot,
}: {
  title: string;
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
  foot?: ReactNode;
}) {
  return (
    <div className="mk-glance">
      <p className="mk-glance-title">{title}</p>
      <dl className="mk-glance-list">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {foot ? <div className="mk-glance-foot">{foot}</div> : null}
    </div>
  );
}

/** Said once and reused, so the band, the sign-up page and the auth panel cannot drift apart. */
export const TRIAL_LINE = `${TRIAL_DAYS}-day free trial, no card.`;

export const FAQ_ITEMS = [
  {
    q: "What does it cost?",
    a: `Every new workspace starts with a ${TRIAL_DAYS}-day free trial of Nora Autopilot, the whole product, and you do not need a card to start it. After the trial you choose Nora Pro or Nora Autopilot, and the pricing page lists what each one costs. Workspaces that signed up before we introduced pricing stay free for good.`,
  },
  {
    q: "Is this safe for my LinkedIn account?",
    a: `It is the constraint we designed around. Sending is ${RAMP_SENTENCE}, spread across your working hours. If LinkedIn shows a warning, a captcha or an unusual login screen, the account pauses itself and tells you. No tool can promise zero risk, because LinkedIn's user agreement prohibits automation, so we say that plainly and keep the volume well under the line.`,
  },
  {
    q: "Do I need Sales Navigator?",
    a: `No. Nora works with any LinkedIn account. A free account can add a note to only ${FREE_NOTES_PER_MONTH} invitations a month, LinkedIn's own limit, and after that Nora sends invitations without one. Sales Navigator, which LinkedIn sells separately, lifts that limit and lets it search more precisely by seniority and company size, and where a filter cannot be applied, the campaign says so before you launch.`,
  },
  {
    q: "Can I approve every message?",
    a: "Yes, and that is the default: Nora drafts each reply from your documents and you approve it with one click. Autopilot is a switch you flip once you trust it, and then clean replies go out on their own. " + alwaysHoldsSentence(),
  },
  {
    q: "What happens when a prospect asks something hard?",
    a: "By default it stops and hands the conversation to you. Pricing, legal or security questions, anything negative, a request to speak to a person, or simply low confidence: all of them park the draft in your inbox instead of sending it.",
  },
];

/**
 * Questions in two columns: the heading holds still on the left while the
 * answers open on the right. `eyebrow` is spent on the home page only, where
 * it is the one small label in seven sections.
 */
export function Faq({
  items = FAQ_ITEMS,
  title = "Questions people ask first",
  eyebrow,
  id,
}: {
  items?: ReadonlyArray<{ q: string; a: string }>;
  title?: string;
  eyebrow?: string;
  id?: string;
}) {
  return (
    <section className="mk-section" id={id}>
      <div className="container mk-faq">
        <div className="mk-faq-head">
          {eyebrow ? <p className="mk-eyebrow">{eyebrow}</p> : null}
          <h2 className="mk-h2">{title}</h2>
        </div>
        <div className="mk-faq-list">
          {items.map((item, index) => (
            <details key={item.q} open={index === 0}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The last thing on every page: one ask, on the one dark ground the site has.
 * A band, not a second hero: the headline and the button side by side, and
 * what it costs in one small line, because by the end of a page the reader
 * needs a way in, not another paragraph.
 */
export function ClosingCta() {
  return (
    <section className="mk-cta" aria-labelledby="mk-cta-title">
      <div className="container">
        <div className="mk-cta-band">
          <div className="mk-cta-copy">
            <h2 id="mk-cta-title">Your first meetings, at a careful pace.</h2>
            <p>{TRIAL_LINE}</p>
          </div>
          <Link href={`${SITE.app}/signup`} className="btn large mk-btn-invert">
            Start a {TRIAL_DAYS}-day free trial
          </Link>
        </div>
      </div>
    </section>
  );
}

/*
 * The footer is the one place every page links from, so it carries the pages
 * search engines most need to find from anywhere: the hubs, the pillar guides
 * and the free tools. A guide only linked from another guide is two clicks
 * deeper than it needs to be.
 *
 * Four columns, each holding one kind of page: what the product is, what to
 * read, what to try, and who makes it. Sign in sits with the company rather
 * than the product because it is the way in for people who already chose.
 */
const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/linkedin-automation-limits", label: "Safety and limits" },
      { href: "/pricing", label: "Pricing" },
      { href: "/free-linkedin-automation-tool", label: "Free LinkedIn automation" },
      { href: "/for", label: "Who it is for" },
      { href: "/alternatives", label: "Compare tools" },
    ],
  },
  {
    title: "Guides",
    links: [
      { href: "/guides/linkedin-prospecting", label: "LinkedIn prospecting" },
      { href: "/guides/linkedin-connection-request-templates", label: "Connection request templates" },
      { href: "/guides/book-meetings-from-linkedin", label: "Book meetings from LinkedIn" },
      { href: "/guides/is-linkedin-automation-safe", label: "Is LinkedIn automation safe?" },
      { href: "/guides/linkedin-account-restricted", label: "Account restricted" },
      { href: "/guides/best-ai-sdr-for-linkedin", label: "Best AI SDR tools" },
      { href: "/guides", label: "All guides" },
    ],
  },
  {
    title: "Free tools",
    links: [
      { href: "/tools/linkedin-limit-calculator", label: "Limit calculator" },
      { href: "/tools/connection-note-checker", label: "Connection note checker" },
      { href: "/tools", label: "All free tools" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/security", label: "Security and data" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      // Absolute: the dashboard is another host, and a relative /login here
      // lands on a marketing page that cannot hold a session.
      { href: `${SITE.app}/login`, label: "Sign in" },
    ],
  },
];

/** Said once, so the site footer and the sign-in pages' footer cannot drift. */
const DISCLAIMER =
  "Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of LinkedIn Corporation.";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" aria-label={`${BRAND.name}, home`} className="site-home">
              <Wordmark />
            </Link>
            <p>An AI SDR for LinkedIn, built inside the limits that keep an account alive.</p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.title} className="footer-column" aria-label={column.title}>
              <p className="footer-title">{column.title}</p>
              {column.links.map((link) => (
                <Link key={link.href} href={link.href} className="footer-link">
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>

        <div className="footer-base">
          <span>
            © {new Date().getFullYear()} {BRAND.name}. {POWERED_BY}.
          </span>
          <span>{DISCLAIMER}</span>
        </div>
      </div>
    </footer>
  );
}

/*
 * The frame around sign in, sign up and password recovery.
 *
 * Somebody on these pages has one job, and the marketing nav beside it offered
 * five ways to leave and a second "Sign up" button on the sign-up page. So the
 * header is the logo and nothing else, and the footer is the one line every
 * page owes LinkedIn plus the pages a careful buyer checks before typing a
 * password. These pages live on the app's host, so every link back to the site
 * is absolute.
 */
export function AuthHeader() {
  return (
    <header className="auth-bar">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="container auth-bar-inner">
        <a href={SITE.url} className="site-home" aria-label={`${BRAND.name}, home`}>
          <Wordmark />
        </a>
      </div>
    </header>
  );
}

export function AuthFooter() {
  return (
    <footer className="auth-base">
      <div className="container auth-base-inner">
        <nav className="auth-base-links" aria-label="Company">
          <a href={`${SITE.url}/security`}>Security and data</a>
          <a href={`${SITE.url}/about`}>About</a>
          <a href={`${SITE.url}/privacy`}>Privacy</a>
          <a href={`${SITE.url}/terms`}>Terms</a>
        </nav>
        <p>
          © {new Date().getFullYear()} {BRAND.name}. {POWERED_BY}. {DISCLAIMER}
        </p>
      </div>
    </footer>
  );
}
