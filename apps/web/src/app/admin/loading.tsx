/**
 * What a page shows while its data is read.
 *
 * Nothing at all used to render until every query had answered, and the
 * console's overview waits on the worker: a blank frame for several seconds
 * reads as a page that is broken. The shape of a page, quiet, says it is on
 * its way.
 */
export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <span className="page-loading-bar is-title" aria-hidden="true" />
      <span className="page-loading-bar is-line" aria-hidden="true" />
      <span className="page-loading-block" aria-hidden="true" />
      <span className="page-loading-block" aria-hidden="true" />
    </div>
  );
}
