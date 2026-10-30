/**
 * When a pending invitation was sent, read from whatever the provider gave.
 *
 * The provider's list of sent invitations carries a timestamp on some rows and
 * only LinkedIn's own words on others ("Sent 3 weeks ago", "Sent today"). Read
 * as a timestamp, those words parsed to nothing, every invitation on every
 * account had no age, and an account carrying 258 unanswered invitations
 * could not tell its old ones from yesterday's. Without an age nothing can be
 * withdrawn safely, so the words are read too.
 *
 * Each unit is read as the *least* time it can mean ("3 weeks" is at least 21
 * days, "1 month" at least 28), so an invitation is never taken for older than
 * it is. Anything not understood is null: unknown is never old.
 */
const UNIT_DAYS: Record<string, number> = {
  minute: 0,
  hour: 0,
  day: 1,
  week: 7,
  month: 28,
  year: 365,
};

export function invitationSentAt(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim().toLowerCase();

  // A timestamp, if it is one. A bare number of words is not.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  const words = text.replace(/^sent\s+/, "");
  if (words === "today" || words === "just now" || /^(a|an|\d+)\s+(minute|hour)s?\s+ago$/.test(words)) {
    return now.toISOString();
  }
  if (words === "yesterday") return new Date(now.getTime() - 86_400_000).toISOString();

  const match = words.match(/^(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/);
  if (!match) return null;
  const count = match[1] === "a" || match[1] === "an" ? 1 : Number(match[1]);
  const days = count * (UNIT_DAYS[match[2]!] ?? 0);
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
