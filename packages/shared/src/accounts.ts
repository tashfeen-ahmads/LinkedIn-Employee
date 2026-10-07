/**
 * Who somebody might be signing in as.
 *
 * Proton gives every mailbox several addresses — name@proton.me, name@pm.me,
 * name@protonmail.com — that all land in the same inbox. To a person they are
 * one address; to an auth system they are three. One customer signed up as
 * …@pm.me, came back days later as …@proton.me, was handed a brand new empty
 * account, and reported "it wants me to start over". So a recovery request
 * looks at every alias of the address typed, and only ever writes back to the
 * address typed — which is the same mailbox.
 */
const PROTON_DOMAINS = ["proton.me", "pm.me", "protonmail.com", "protonmail.ch"] as const;

export function emailAliases(raw: string): string[] {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return [];
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if ((PROTON_DOMAINS as readonly string[]).includes(domain)) {
    return PROTON_DOMAINS.map((d) => `${local}@${d}`);
  }
  return [email];
}

/** An identifier a person typed: an email address, or a username. */
export function loginIdentifier(raw: string): { kind: "email"; email: string } | { kind: "username"; username: string } | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("@")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? { kind: "email", email: value.toLowerCase() } : null;
  }
  return /^[A-Za-z0-9._-]{2,64}$/.test(value) ? { kind: "username", username: value } : null;
}
