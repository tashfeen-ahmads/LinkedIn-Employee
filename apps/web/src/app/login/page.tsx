import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { AuthAside } from "@/components/auth-aside";
import { PasswordField } from "@/components/password-field";
import { SubmitButton } from "@/components/submit-button";
import { PostButton } from "@/components/post-button";
import { SITE } from "@/lib/site";
import { CONFIRMED_ELSEWHERE, LINK_DID_NOT_WORK } from "@/lib/auth-callback";

/*
 * What `?error=` and `?notice=` may say, decided here rather than by the URL.
 *
 * The page used to print whatever the query string carried, in the product's
 * own red or green banner, under its own logo: anybody could send a link to
 * /login?error=Your+account+is+suspended.+Call+… and it would read as us. So
 * the parameter is a key. This page's own redirects send short codes; the
 * sign-in route and the confirmation callback send whole sentences, which are
 * matched exactly and answered with this page's copy. Anything else gets one
 * plain sentence that says nothing it was not told.
 */
const ERRORS: Record<string, string> = {
  email: "Enter your work email.",
  "invalid-email": "That does not look like an email address. Check it and try again.",
  "rate-limit": "Too many sign-in emails for that address. Wait a few minutes, then try again.",
  "link-failed": "We could not send a sign-in link just now. Try again in a minute, or sign in with your password.",
  // Sent by /auth/sign-in.
  "Enter your email and password.": "Enter your email and password.",
  "Open the confirmation link we emailed you first — it is what proves the address is yours.":
    "Open the confirmation link we emailed you first. It is what proves the address is yours.",
  "That email and password do not match an account. Use Forgot password below if you are not sure.":
    "That email and password do not match an account. Use Forgot password below if you are not sure.",
  // Sent by /auth/callback.
  [LINK_DID_NOT_WORK]:
    "That link did not sign you in. It may have expired or already been used. Sign in with your password, or ask for a new link below.",
  "Missing sign-in code":
    "That link did not sign you in. It may have expired or already been used. Sign in with your password, or ask for a new link below.",
};
const UNKNOWN_ERROR = "That did not work. Try again, or use Forgot password below.";

const NOTICES: Record<string, string> = {
  [CONFIRMED_ELSEWHERE]: "Your email is confirmed. Sign in with your password to continue.",
};

function lookup(map: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** A provider refusal, as a code this page has copy for. Never its own words. */
function linkErrorCode(error: { message?: string; code?: string; status?: number }): string {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (error.status === 429 || /rate[ _-]?limit|too many/.test(text)) return "rate-limit";
  if (/email_address_invalid|invalid.*email|email.*invalid/.test(text)) return "invalid-email";
  return "link-failed";
}

/**
 * Magic-link sign in. No passwords to store, and the same form serves signup
 * and login: a new email gets an account, an existing one gets a session.
 */
async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const invite = String(formData.get("invite") ?? "").trim();
  const back = invite ? `&invite=${encodeURIComponent(invite)}` : "";
  if (!email) redirect(`/login?error=email${back}`);

  // `SITE.app`, normalised: a trailing slash on APP_URL produced
  // `https://app…//auth/callback`, which the provider refuses as a redirect.
  const base = SITE.app;
  // An invited user should land back on their invitation, not on onboarding.
  const callback = invite
    ? `${base}/auth/callback?invite=${encodeURIComponent(invite)}`
    : `${base}/auth/callback`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callback } });

  redirect(error ? `/login?error=${linkErrorCode(error)}${back}` : `/login?sent=1${back}`);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; notice?: string; invite?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? (lookup(ERRORS, params.error) ?? UNKNOWN_ERROR) : null;
  const notice = params.notice ? lookup(NOTICES, params.notice) : undefined;

  // Deployed ahead of its database, which is how the marketing site gets to be
  // live first. Saying so is better than a sign-in form that returns a 500.
  if (!isAppConfigured()) {
    return (
      <>
        <SiteHeader />
        <div className="auth-split">
        <main className="auth-page" id="main" tabIndex={-1}>
          <header>
            <h1>Not open yet</h1>
            <p className="muted">
              We are still setting this up. Sign-ups open once the first campaigns have run under
              supervision. We would rather be late than have the first thing our software does be
              something a stranger receives by mistake.
            </p>
          </header>
          <p className="muted">
            <a href="/">Back to the site</a>
          </p>
        </main>
        <AuthAside />
        </div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <div className="auth-split">
      <main className="auth-page" id="main" tabIndex={-1}>
        <header>
          <h1>Sign in</h1>
          <p className="muted">
            New here?{" "}
            <Link href={params.invite ? `/signup?invite=${encodeURIComponent(params.invite)}` : "/signup"}>
              Create an account
            </Link>
            .
          </p>
        </header>

        {params.sent ? (
          <div className="notice" role="status">
            Check your inbox. The link is valid for one hour.
          </div>
        ) : null}
        {/* Good news in its own colour: a confirmed address arriving here is
            a success, and the red banner told people their signup had failed. */}
        {notice ? (
          <div className="notice accent" role="status">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}

        <form action="/auth/sign-in" method="post" className="card">
          {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
          <label className="field">
            <span>Email or username</span>
            <input
              name="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@company.com"
            />
          </label>
          <PasswordField name="password" label="Password" autoComplete="current-password" />
          <PostButton className="btn block" pendingLabel="Signing in…">
            Sign in
          </PostButton>
        </form>

        {/*
          The two ways people get locked out, named where they are standing.
          Every login complaint so far was one of these: a forgotten password,
          or a different address from the one the workspace was set up with —
          which signs in fine and then asks them to start over.
        */}
        <p className="small">
          <Link href="/forgot">Forgot password?</Link> · <Link href="/forgot?kind=signin">Forgot which email you used?</Link>
        </p>

        {/*
          Kept, not replaced. It is the way back in for anybody who has
          forgotten a password, and the only way in for the accounts made
          before passwords existed — several of which are real people using
          this today.
        */}
        <details className="auth-alt">
          <summary className="small muted">Never set a password? Email me a sign-in link</summary>
          <form action={sendMagicLink} className="card">
            {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
            <label className="field">
              <span>Work email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="you@company.com"
              />
            </label>
            <SubmitButton className="btn secondary block" pendingLabel="Sending…">
              Email me a sign-in link
            </SubmitButton>
          </form>
        </details>
      </main>
      <AuthAside />
      </div>
      <SiteFooter />
    </>
  );
}
