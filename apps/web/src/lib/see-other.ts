/**
 * A 303 whose Location is the path alone, resolved by the browser against the
 * page it is on.
 *
 * `NextResponse.redirect(new URL(path, request.url))` builds the address from
 * `request.url`, and on Netlify that is the host the instance first served,
 * not necessarily the one this visitor is on. A form posted from
 * app.norasdr.com could be sent on to norasdr.com, where no session lives. A
 * relative Location cannot change host.
 */
export function seeOther(path: string): Response {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`seeOther takes a path, got ${path}`);
  return new Response(null, { status: 303, headers: { Location: path } });
}
