import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DB_SCHEMA } from "@le/db";
import { SETUP_DONE_COOKIE, gatesSetup, setupRedirect } from "@/lib/wizard";

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
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data.session?.user.id ?? null;
  } catch {
    // A provider outage must not take the page down with it; the page's own
    // check decides what the visitor sees.
  }

  /*
   * Setup comes first (rule 65).
   *
   * Until the workspace has launched a campaign, every app page goes to the
   * onboarding step somebody is on. Here rather than in the app layout: a
   * layout is not rendered again when somebody clicks between pages under it,
   * so a check there let anyone on an open page walk into the rest of the app
   * from the sidebar. Every navigation reaches the middleware.
   *
   * Page loads only, never a form's POST, so a server action or a retry posted
   * from onboarding still runs. A lookup that fails lets the page through
   * rather than sending somebody with live campaigns back to setup (rule 17).
   * Once launched is seen it is remembered in a cookie naming this user, so a
   * finished workspace makes no extra query on any page after that.
   */
  const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (userId && gatesSetup(request.method, request.nextUrl.pathname) && request.cookies.get(SETUP_DONE_COOKIE)?.value !== userId) {
    // This person's own workspace, never "any campaign I can see": a platform
    // admin can read every workspace's campaigns (rule 15), and somebody
    // else's launch is not the end of this person's setup.
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const { data, error } = membership
      ? await supabase
          .from("campaigns")
          .select("id")
          .eq("workspace_id", membership.workspace_id)
          .not("launched_at", "is", null)
          .limit(1)
      : { data: null, error: membershipError ?? { message: "no workspace" } };
    if (!error && data) {
      if (data.length > 0) {
        response.cookies.set(SETUP_DONE_COOKIE, userId, {
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
      } else {
        const target = request.nextUrl.clone();
        const [pathname, query = ""] = setupRedirect(path).split("?");
        target.pathname = pathname!;
        target.search = query ? `?${query}` : "";
        const redirect = NextResponse.redirect(target);
        // The refreshed session travels with the redirect, or it is lost.
        for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
        return redirect;
      }
    }
  }
  return response;
}

export const config = {
  // Only the screens that hold a session. Marketing pages stay off this path.
  matcher: ["/app/:path*", "/admin/:path*", "/onboarding/:path*", "/invite/:path*", "/reset-password"],
};
