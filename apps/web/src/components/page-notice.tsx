/**
 * The banner a server action leaves behind when something went wrong.
 *
 * An action that redirects has no other way to say anything to the page it came
 * from, so the message travels in the query string and is rendered here. Four
 * pages were being sent `?error=` and reading no search params at all, which
 * would have put these messages nowhere — the same silence the errors were
 * added to break.
 *
 * `role="status"` rather than `role="alert"`: this appears on load, after a
 * navigation, so a screen reader announces it in turn rather than interrupting.
 */
export function PageNotice({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <div className={`notice ${error ? "danger" : "accent"}`} role="status">
      <p>{error ?? notice}</p>
    </div>
  );
}

/** What every page's `searchParams` needs to accept for the banner to arrive. */
export type NoticeParams = Promise<{ error?: string; notice?: string }>;
