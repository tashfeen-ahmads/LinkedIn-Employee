import type { ReactNode } from "react";

/*
 * The frame for the two legal pages: a table of contents and one reading
 * column. Each section is a heading and its paragraphs, and the contents list
 * is built from the same array, so a section cannot be added to the page and
 * left out of the list that links to it.
 */

/** Who stands behind both documents, and how to reach them. Said once. */
export const LEGAL = {
  entity: "Nova First Technologies",
  email: "brian@virtualpros.com",
  updated: "October 15, 2026",
} as const;

export interface LegalSection {
  /** The anchor the contents list links to. */
  id: string;
  title: string;
  body: ReactNode;
}

export function LegalEmail() {
  return <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
}

export function LegalDocument({ sections }: { sections: ReadonlyArray<LegalSection> }) {
  return (
    <section className="mk-section mk-section-tight">
      <div className="container legal-layout">
        <nav className="legal-toc" aria-labelledby="legal-toc-title">
          <p className="legal-toc-title" id="legal-toc-title">
            On this page
          </p>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="article-body legal-body">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="legal-section"
              aria-labelledby={`${section.id}-title`}
            >
              <h2 id={`${section.id}-title`}>{section.title}</h2>
              {section.body}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
