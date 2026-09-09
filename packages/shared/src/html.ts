/**
 * HTML escaping, in one place.
 *
 * This lived twice — once in the CRM adapter and once in the email renderer —
 * and the two had already drifted: one escaped the single quote and the other
 * did not. Both take text a prospect wrote and put it somewhere a person will
 * read it, so they need the same answer.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
