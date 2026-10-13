import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, YOUR_DECISIONS } from "@le/shared";

/**
 * The landing-page pieces the /for/* pages and the free-tool page share: the
 * three decisions a person keeps, the limits as figures, and one invented
 * note in the shape the review screen shows. Each page chooses its own words
 * around them so the five pages do not read as one template.
 */

/**
 * The three approvals, in order, from the product tour itself
 * (`YOUR_DECISIONS`), so a page can never list a fourth gate or miss one.
 * Each page says in its own words what the step means for its reader.
 */
export function AudSteps({
  id,
  title,
  intro,
  notes,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  notes: readonly [React.ReactNode, React.ReactNode, React.ReactNode];
}) {
  return (
    <>
      <h2 id={id}>{title}</h2>
      {intro ? <p>{intro}</p> : null}
      <ol className="aud-steps">
        {YOUR_DECISIONS.map((decision, index) => (
          <li key={decision.title}>
            <span className="aud-step-num" aria-hidden="true">
              {index + 1}
            </span>
            <strong>{decision.title}</strong>
            <span>{notes[index]}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** A row of figures. Values come from imports on the page, never typed in. */
export function AudStats({
  label,
  items,
}: {
  /** What the figures are, for a screen reader moving through the page. */
  label: string;
  items: ReadonlyArray<{ value: React.ReactNode; label: string }>;
}) {
  return (
    <figure className="aud-figures">
      <figcaption className="sr-only">{label}</figcaption>
      <dl
        className="aud-stats"
        // Four or fewer sit on one row; more wrap in threes rather than 4 + 2.
        style={{ "--aud-cols": items.length <= 4 ? items.length : 3 } as React.CSSProperties}
      >
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

/**
 * One invented connection note, laid out the way a reviewer reads it before
 * launch: who it is for, the note, its length against the cap, and the profile
 * details it leans on.
 */
export function AudNote({
  to,
  role,
  text,
  used,
}: {
  to: string;
  role: string;
  text: string;
  used: readonly string[];
}) {
  if (text.length > INVITE_NOTE_MAX_CHARS) {
    // A sample longer than the cap would show a note Nora refuses to send.
    throw new Error(`sample note for ${to} is ${text.length} characters`);
  }
  return (
    <figure className="aud-note">
      <figcaption className="aud-note-head">
        <span className="aud-note-tag">Invented example</span>
        <span>
          <strong>{to}</strong>, {role}
        </span>
      </figcaption>
      <blockquote>
        <p>{text}</p>
      </blockquote>
      <div className="aud-note-foot">
        <span>
          {text.length} of {INVITE_NOTE_MAX_CHARS} characters, no link
        </span>
        <ul aria-label="Profile details the note uses">
          {used.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

/** Every audience page, in the order the /for hub lists them. */
const AUDIENCES = [
  { path: "/for/small-business", label: "Small businesses" },
  { path: "/for/consultants", label: "Consultants and coaches" },
  { path: "/for/agencies", label: "Agencies" },
  { path: "/for/b2b-saas", label: "B2B SaaS founders" },
  { path: "/for/professional-services", label: "Professional services firms" },
] as const;

/**
 * The other audience pages, as one row of links at the end of a page. It
 * replaces a closing paragraph per page that strung the same five links into
 * a sentence.
 */
export function AudMore({ current }: { current: (typeof AUDIENCES)[number]["path"] }) {
  return (
    <nav className="aud-more" aria-label="Nora for other teams">
      <p className="aud-more-title">Not quite you? Nora for</p>
      <ul>
        {AUDIENCES.filter((a) => a.path !== current).map((a) => (
          <li key={a.path}>
            <Link href={a.path}>{a.label}</Link>
          </li>
        ))}
        <li>
          <Link href="/for">Every use case</Link>
        </li>
      </ul>
    </nav>
  );
}
