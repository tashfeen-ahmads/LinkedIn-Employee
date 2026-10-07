import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/*
 * Keeps a signed-in session signed in.
 *
 * An access token lasts an hour. After that the next page refreshes it — but a
 * page render cannot set cookies, so the new tokens were thrown away and the
 * browser kept the old refresh token. Refresh tokens are single-use: the next
 * page spent the same one again, and a few seconds later the provider refused
 * it and ended the session. Anybody who left the dashboard open for an hour
 * was signed out two clicks after coming back, with nothing on any screen
 * saying why.
 *
 * Here the cookies can be written: on the request, so the page about to
 * render reads the new tokens, and on the response, so the browser keeps them.
 * `getSession` only calls out when the token has actually expired, so a
 * normal page costs nothing extra. It is not an authorisation check and is
 * never used as one — `requireSession` asks the provider who this is on every
 * page.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  try {
    await supabase.auth.getSession();
  } catch {
    // A provider outage must not take the page down with it; the page's own
    // check decides what the visitor sees.
  }
  return response;
}

export const config = {
  // Only the screens that hold a session. Marketing pages stay off this path.
  matcher: ["/app/:path*", "/admin/:path*", "/onboarding/:path*", "/invite/:path*", "/reset-password"],
};
