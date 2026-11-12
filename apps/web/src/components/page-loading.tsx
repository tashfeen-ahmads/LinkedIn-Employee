/**
 * What a page shows while its data is read.
 *
 * The shape was drawn in `--surface-sunken` on `--bg`, about 1.05:1, and
 * pulsed down to half opacity, so for the one to four seconds a page takes
 * after a press the main area read as blank white: a page that had broken,
 * not one on its way. The placeholder is now drawn in the frame's own
 * strokes, the cards are cards, and it says in words that it is loading.
 */
export function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <p className="page-loading-label">Loading…</p>
      <span className="page-loading-bar is-title" aria-hidden="true" />
      <span className="page-loading-bar is-line" aria-hidden="true" />
      <span className="page-loading-block" aria-hidden="true" />
      <span className="page-loading-block" aria-hidden="true" />
    </div>
  );
}
