import Link from "next/link";
import type { ReactNode } from "react";
import { SiteMenu, SiteNav } from "./site-nav";
import { BRAND, LINKEDIN_LIMITS } from "@le/shared";
import { SITE } from "@/lib/site";
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
 * Four links, one line. Safety goes to the limits page, because that page is
 * where the numbers are, and Pricing is back because "what does it cost" is
 * the question people ask before any other.
 */
const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/linkedin-automation-limits", label: "Safety" },
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
            Sign up free
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
}: {
  children: ReactNode;
  lede?: ReactNode;
  crumb?: string;
  actions?: ReactNode;
}) {
  return (
    <section className="mk-page-hero hero-wash">
      <div className="container mk-page-hero-inner">
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
    </section>
  );
}

/** Said once and reused, so the band and /pricing cannot drift apart. */
export const FREE_LINE = "Free for now, for everyone.";

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

/** The last thing on every page: one ask, on the one dark ground the site has. */
export function ClosingCta() {
  return (
    <section className="mk-cta" aria-labelledby="mk-cta-title">
      <div className="container">
        <div className="mk-cta-band">
          <h2 id="mk-cta-title">Your first meetings, at a careful pace.</h2>
          <p>{FREE_LINE} No card, and nothing is sent until you launch.</p>
          <Link href={`${SITE.app}/signup`} className="btn large mk-btn-invert">
            Sign up free
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
 */
const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/free-linkedin-automation-tool", label: "Free LinkedIn automation" },
      { href: "/alternatives", label: "Compare tools" },
      // Absolute: the dashboard is another host, and a relative /login here
      // lands on a marketing page that cannot hold a session.
      { href: `${SITE.app}/login`, label: "Sign in" },
    ],
  },
  {
    title: "Guides",
    links: [
      { href: "/guides/linkedin-prospecting", label: "LinkedIn prospecting" },
      { href: "/guides/linkedin-connection-request-templates", label: "Connection request templates" },
      { href: "/guides/book-meetings-from-linkedin", label: "Book meetings from LinkedIn" },
      { href: "/guides/best-ai-sdr-for-linkedin", label: "Best AI SDR tools" },
      { href: "/guides", label: "All guides" },
    ],
  },
  {
    title: "Safety",
    links: [
      { href: "/linkedin-automation-limits", label: "LinkedIn automation limits" },
      { href: "/guides/is-linkedin-automation-safe", label: "Is LinkedIn automation safe?" },
      { href: "/guides/linkedin-account-restricted", label: "Account restricted" },
      { href: "/security", label: "Security and data" },
    ],
  },
  {
    title: "Free tools",
    links: [
      { href: "/tools/linkedin-limit-calculator", label: "Limit calculator" },
      { href: "/tools/connection-note-checker", label: "Connection note checker" },
      { href: "/about", label: "About Nora" },
    ],
  },
];

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
            © {new Date().getFullYear()} {BRAND.full}
          </span>
          <span>
            Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of its owner, and
            automated access is against their user agreement, which is why the limits on this site
            are what they are.
          </span>
        </div>
      </div>
    </footer>
  );
}
