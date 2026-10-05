import { headers } from "next/headers";
import { BRAND, appOrigin, siteOrigin } from "@le/shared";

/**
 * Where Next fetches a page from after a server action redirects.
 *
 * A Save that ends in `redirect("/app/profile?notice=Saved.")` does not hand
 * the browser a Location. Next renders the target itself, by fetching it over
 * HTTP from `__NEXT_PRIVATE_ORIGIN`, forwarding the browser's cookie. Under
 * `next start` that variable is set when the server listens. On Netlify nothing
 * listens: the runtime builds the server once per instance from the **first**
 * request it happens to receive, and the marketing site and the dashboard share
 * those instances. An instance that first served norasdr.com fetched every
 * later redirect from norasdr.com, netlify.toml bounced it to app.norasdr.com,
 * and fetch drops the cookie on a redirect to another host — so the page after
 * every Save rendered signed out and sent a signed-in person to /login. The
 * session itself was fine throughout; their browser still held it.
 *
 * So the origin is pinned, per request, to the host the browser actually
 * asked. Only hosts this deployment is known to serve are trusted: the Host
 * header is the client's to write, and the server fetches whatever is pinned
 * with the visitor's cookie attached. An unknown host leaves the platform's own
 * value alone. A Netlify instance serves one request at a time, so the pin
 * cannot leak between visitors on the host where it matters.
 */
export function originForHost(
  host: string | null | undefined,
  forwardedProto: string | null | undefined,
  known: readonly string[],
): string | null {
  if (!host) return null;
  const wanted = host.trim().toLowerCase();
  for (const origin of known) {
    try {
      if (new URL(origin).host.toLowerCase() === wanted) return new URL(origin).origin;
    } catch {
      // A malformed configured origin is skipped rather than trusted.
    }
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(wanted)) {
    const proto = forwardedProto?.split(",")[0]?.trim() === "https" ? "https" : "http";
    return `${proto}://${wanted}`;
  }
  return null;
}

export function knownOrigins(): string[] {
  return [
    appOrigin(process.env.APP_URL),
    BRAND.app,
    siteOrigin(process.env.NEXT_PUBLIC_SITE_URL),
    BRAND.site,
  ];
}

/** Points Next's post-action fetch at the host this request arrived on. */
export async function pinRequestOrigin(): Promise<void> {
  const h = await headers();
  const origin = originForHost(h.get("host"), h.get("x-forwarded-proto"), knownOrigins());
  if (origin) process.env.__NEXT_PRIVATE_ORIGIN = origin;
}
