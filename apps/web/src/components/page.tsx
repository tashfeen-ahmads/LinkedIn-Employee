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
  crumbs,
  title,
  status,
  lede,
  actions,
}: {
  /** The section this page belongs to. Optional, and never the page's name. */
  eyebrow?: string;
  /**
   * The way back up, for a page that lives inside a list: "Campaigns / this
   * campaign". Replaces the eyebrow when given, because both say where the page
   * belongs and one of them is a link.
   */
  crumbs?: { href: string; label: string }[];
  title: string;
  /** A status chip beside the title, for a page that is one thing with a state. */
  status?: ReactNode;
  /** One sentence on what the screen is for. Not a paragraph. */
  lede?: ReactNode;
  /** The one or two things you can do to the whole page. */
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {crumbs?.length ? (
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((crumb) => (
                <li key={crumb.href}>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </li>
              ))}
              <li aria-current="page">{title}</li>
            </ol>
          </nav>
        ) : eyebrow ? (
          <p className="page-eyebrow">{eyebrow}</p>
        ) : null}
        {status ? (
          <div className="page-title-row">
            <h1>{title}</h1>
            {status}
          </div>
        ) : (
          <h1>{title}</h1>
        )}
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
  framed = false,
  surface,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  id?: string;
  /**
   * The section is its own panel: the title sits inside the surface, at a
   * panel's size rather than a page section's. For dashboards, where two or
   * three titled panels share a row and a heading above each would float
   * between them.
   */
  framed?: boolean;
  /**
   * A section that is a card with a look of its own: the overview's NeedsYou,
   * NextStep and SetupChecklist. Rule 34 gives the `<h2>` to this component
   * and nobody else, and those three each wrote their own; this keeps the
   * heading here while each keeps its own class, so the level is owned in one
   * place and none of their looks changes. Replaces the frame's `section`
   * class and header row, so `framed` and `action` do not apply.
   */
  surface?: {
    /** The section element's class, in place of `section`. */
    className: string;
    /** A small label above the title. */
    eyebrow?: ReactNode;
    /** The heading's own class. */
    headingClassName?: string;
    /** Inside the heading, after the title: a count, say. */
    aside?: ReactNode;
    /** Wraps the heading and its description, when the card groups them. */
    headerClassName?: string;
  };
}) {
  const headingId = id ? `${id}-heading` : undefined;
  if (surface) {
    const heading = title ? (
      <h2 id={headingId} className={surface.headingClassName}>
        {title}
        {surface.aside}
      </h2>
    ) : null;
    const said = description ? <p className="small muted">{description}</p> : null;
    return (
      <section className={surface.className} aria-labelledby={title ? headingId : undefined}>
        {surface.eyebrow ? <p className="eyebrow">{surface.eyebrow}</p> : null}
        {surface.headerClassName ? (
          <div className={surface.headerClassName}>
            {heading}
            {said}
          </div>
        ) : (
          <>
            {heading}
            {said}
          </>
        )}
        {children}
      </section>
    );
  }
  return (
    <section className={framed ? "section card is-framed" : "section"} aria-labelledby={headingId}>
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

/**
 * What a list says when it could not be read, which is not what it says when
 * it is empty.
 *
 * Seven console pages read a failed query as no rows and said "No workspaces
 * yet" or "Nothing has happened yet". An operator believing that goes to
 * investigate a platform with no customers rather than a database that did not
 * answer (rule 17).
 */
export function LoadFailed({ what }: { what: string }) {
  return (
    <div className="notice danger" role="alert">
      <p>
        <strong>{what} could not be loaded.</strong> The database did not answer, so this is not an empty list.
        Reload in a minute.
      </p>
    </div>
  );
}
