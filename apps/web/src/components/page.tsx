import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame every application screen is built in.
 *
 * Before this, each page composed its own heading: some had `page-head`, some
 * did not, four had no wrapper at all, and seven had two or three `<h1>`s —
 * which is precisely the "title, mini title, title under the title" a person
 * sees as mess. It is not a styling problem. A page with three h1s has no
 * heading, because nothing is above anything else.
 *
 * So the structure is a component rather than a convention. One `PageHeader`
 * per screen, which is the only place an `<h1>` may appear; `Section` for
 * everything under it, which is the only place an `<h2>` may. Spacing is set
 * here once, so two screens cannot drift apart.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  /** The section this page belongs to. Optional, and never the page's name. */
  eyebrow?: string;
  title: string;
  /** One sentence on what the screen is for. Not a paragraph. */
  lede?: ReactNode;
  /** The one or two things you can do to the whole page. */
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p className="muted prose">{lede}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

/**
 * The surface a section's content sits on.
 *
 * Measured on the overview: six sections wrapped their content in a card and
 * four did not, so "Today", "Inside your limits", "How it is going" and "This
 * week" rendered as bare text and bars straight onto the page background — a
 * transparent box with no border and no padding, directly beside a bordered,
 * padded one. That is what a person reads as "some blocks look like a website
 * with no styling", and it is not a judgement about any one screen: it is four
 * call sites that each decided for themselves, which is precisely the drift
 * rule 34 built `PageHeader` and `Section` to stop.
 *
 * So the container is part of the frame. `Panel` *is* a card — the same class,
 * not a second look — and the point of the name is that a section's content
 * asks for one rather than each page remembering to.
 *
 * `bare` is the deliberate exception: a row of tiles that are already cards, or
 * a table that brings its own frame, must not be wrapped again or it renders a
 * box inside a box (rule 38's collision, in markup rather than CSS).
 */
export function Panel({
  children,
  bare = false,
  className,
}: {
  children: ReactNode;
  /** This content already carries its own frame. */
  bare?: boolean;
  className?: string;
}) {
  if (bare) return <>{children}</>;
  return <div className={className ? `card ${className}` : "card"}>{children}</div>;
}

/**
 * A titled group of content.
 *
 * `title` renders the screen's only heading level below the page title, and an
 * optional `action` sits on its right — the pattern every CRM uses, because the
 * thing you do to a list belongs beside the list's name rather than buried
 * under it.
 */
export function Section({
  title,
  description,
  action,
  children,
  id,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="section" aria-labelledby={headingId}>
      {title ? (
        <div className="section-header">
          <div className="section-header-text">
            <h2 id={headingId}>{title}</h2>
            {description ? <p className="small muted prose">{description}</p> : null}
          </div>
          {action ? <div className="section-header-action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * What a list says when it has nothing in it.
 *
 * Always a sentence about why it is empty and the one thing to do about it —
 * never the word "None". An empty state is the screen a new customer sees most
 * often, and it is the one most often left as a shrug.
 */
export function Empty({
  title,
  children,
  action,
  href,
}: {
  title: string;
  children?: ReactNode;
  action?: string;
  href?: string;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="small muted prose">{children}</p> : null}
      {action && href ? (
        <p>
          <Link className="btn secondary small" href={href}>
            {action}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Several sections under one anchor, keeping the page's rhythm.
 *
 * A page is a flex column and its gap falls between its direct children, so
 * wrapping two sections in a plain `<div id="team">` — which is all an anchor
 * has to be — makes the pair one child: spacing either side of them, and none
 * between them. Every section merged into Profile and into the overview ran
 * into the next one, which reads as a page where some things have padding and
 * some have none.
 *
 * A component rather than a class somebody remembers, for the same reason
 * `Section` is one: the frame owns spacing, and a convention nothing enforces
 * drifts back within a month.
 */
export function PageGroup({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div className="page-group" id={id}>
      {children}
    </div>
  );
}
