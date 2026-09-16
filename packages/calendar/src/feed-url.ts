/**
 * Whether an address is safe for this server to fetch.
 *
 * A calendar feed URL is typed in by a user and fetched by the worker, which is
 * the definition of server-side request forgery. The worker holds the database
 * service-role key and its own internal API answers on localhost, so a feed
 * pointed at `http://127.0.0.1:4000/jobs/...` or at a cloud metadata endpoint
 * is not a broken calendar, it is a way to reach things no browser could.
 *
 * So: https only, and never an address inside this network. The check is on the
 * resolved IP rather than the hostname, because a name the attacker controls
 * can resolve wherever they like — the caller resolves and asks here.
 */

export type UrlVerdict = { ok: true } | { ok: false; reason: string };

export function checkFeedUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(toHttps(raw));
  } catch {
    return { ok: false, reason: "That is not a web address." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Calendar feeds must be https. The address holds your whole calendar, so it cannot travel in the clear." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the username and password from the address; the secret part of the link is enough." };
  }
  if (isPrivateHostname(url.hostname)) {
    return { ok: false, reason: "That address points inside a private network." };
  }
  return { ok: true };
}

/** The https form of a feed address, for storing and fetching. */
export function normalizeFeedUrl(raw: string): string {
  return new URL(toHttps(raw)).toString();
}

/**
 * `webcal://` is what Apple and Outlook hand out, and it is https underneath.
 *
 * Swapped before parsing rather than after, because `url.protocol = "https:"`
 * is silently a no-op on a non-special scheme — WHATWG will not promote one —
 * so the assignment appeared to work and every webcal address was then
 * rejected for not being https. A test caught it; nothing else would have.
 */
function toHttps(raw: string): string {
  return raw.trim().replace(/^webcal:\/\//i, "https://");
}

/** Literal addresses and names that never leave the machine. */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  return isPrivateIp(host);
}

/**
 * Whether an IP is one this server must never be pointed at.
 *
 * Exported because the fetch has to check it again after DNS, and again after
 * every redirect: a name that resolved publicly a moment ago can be re-pointed,
 * and a 302 to `http://169.254.169.254/` undoes every check made before it.
 */
export function isPrivateIp(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // Link-local, and the address every cloud serves instance credentials on.
    if (a === 169 && b === 254) return true;
    // Carrier-grade NAT, and the range this product's own infrastructure uses.
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (address.includes(":")) {
    const v6 = address.toLowerCase();
    if (v6 === "::" || v6 === "::1") return true;
    // Unique-local and link-local.
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    // ::ffff:127.0.0.1 is loopback wearing a v6 coat.
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v6);
    if (mapped) return isPrivateIp(mapped[1]!);
    return false;
  }

  return false;
}
