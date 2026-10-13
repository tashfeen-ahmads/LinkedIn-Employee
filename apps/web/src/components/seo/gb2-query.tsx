/**
 * A LinkedIn search written out the way the search page asks for it: what goes
 * in the keyword box, and what is picked from each filter. Used on the
 * prospecting guides, so an example query reads as a form to copy rather than
 * a sentence with code wrapped through the middle of it. Server-only.
 */
export function SearchRecipe({
  title,
  keywords,
  filters,
}: {
  title: string;
  keywords: string;
  filters: ReadonlyArray<{ label: string; value: string }>;
}) {
  return (
    <figure className="gb2-query">
      <figcaption className="gb2-chart-title">{title}</figcaption>
      <dl className="gb2-query-list">
        <div>
          <dt>Keyword box</dt>
          <dd>
            <code className="gb2-code">{keywords}</code>
          </dd>
        </div>
        {filters.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
