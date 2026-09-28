import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { GoogleGlyph } from "@/components/google-glyph";
import { SubmitButton } from "@/components/submit-button";

/**
 * Magic-link sign in. No passwords to store, and the same form serves signup
 * and login: a new email gets an account, an existing one gets a session.
 */
async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const invite = String(formData.get("invite") ?? "").trim();
  if (!email) redirect("/login?error=Enter+your+work+email");

  const base = process.env.APP_URL ?? "http://localhost:3000";
  // An invited user should land back on their invitation, not on onboarding.
  const callback = invite
    ? `${base}/auth/callback?invite=${encodeURIComponent(invite)}`
    : `${base}/auth/callback`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callback } });

  redirect(error ? `/login?error=${encodeURIComponent(error.message)}` : "/login?sent=1");
}

/**
 * Password sign-in.
 *
 * The primary way in now that signup collects one. The magic link stays below
 * it rather than being replaced: it is the recovery path for somebody who has
 * forgotten the password, and the only path for the accounts created before
 * passwords existed — several of which are real people using this today.
 *
 * The refusal is deliberately one sentence for both halves. "No account with
 * that email" and "wrong password" told apart is a way to learn which
 * addresses have accounts here, one guess at a time.
 */
async function signInWithPassword(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const invite = String(formData.get("invite") ?? "").trim();
  const q = invite ? `&invite=${encodeURIComponent(invite)}` : "";

  if (!email || !password) redirect(`/login?error=${encodeURIComponent("Enter your email and password.")}${q}`);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    /*
     * An unconfirmed address is the one case worth naming, because the fix is
     * different: the password is right and the mail is sitting unopened, and
     * "email or password is wrong" would send them to reset a password that
     * works.
     */
    const unconfirmed = /confirm/i.test(error.message);
    redirect(
      `/login?error=${encodeURIComponent(
        unconfirmed
          ? "Open the confirmation link we emailed you first — it is what proves the address is yours."
          : "That email and password do not match an account.",
      )}${q}`,
    );
  }

  redirect(invite ? `/invite/${encodeURIComponent(invite)}` : "/app");
}

/**
 * Google sign-in.
 *
 * Beside the magic link rather than instead of it: a work Google account is one
 * click, and the magic link is the fallback for anyone whose company does not
 * use Google. Both land on the same callback and produce the same session.
 */
async function signInWithGoogle(formData: FormData) {
  "use server";
  const invite = String(formData.get("invite") ?? "").trim();
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const callback = invite
    ? `${base}/auth/callback?invite=${encodeURIComponent(invite)}`
    : `${base}/auth/callback`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback,
      // A refresh token, so the session survives without sending them back to
      // Google every hour.
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? "Could not reach Google")}`);
  }
  redirect(data.url);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; invite?: string }>;
}) {
  const params = await searchParams;

  // Deployed ahead of its database, which is how the marketing site gets to be
  // live first. Saying so is better than a sign-in form that returns a 500.
  if (!isAppConfigured()) {
    return (
      <>
        <SiteHeader />
        <main className="auth-page">
          <header>
            <h1>Not open yet</h1>
            <p className="muted">
              We are still setting this up. Trials open once the first campaigns have run under
              supervision — we would rather be late than have the first thing our software does be
              something a stranger receives by mistake.
            </p>
          </header>
          <p className="muted">
            <a href="/">Back to the site</a>
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="auth-page">
        <header>
          <h1>Sign in</h1>
          <p className="muted">
            New here? <Link href={params.invite ? `/signup?invite=${params.invite}` : "/signup"}>Create an account</Link>.
          </p>
        </header>

        {params.sent ? (
          <div className="notice">Check your inbox. The link is valid for one hour.</div>
        ) : null}
        {params.error ? <div className="notice danger">{params.error}</div> : null}

        <form action={signInWithGoogle}>
          {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
          <button className="btn secondary block" type="submit">
            <GoogleGlyph />
            Continue with Google
          </button>
        </form>

        <div className="or-rule">
          <span className="tiny subtle">or with your password</span>
        </div>

        <form action={signInWithPassword} className="card">
          {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
          <label className="field">
            <span>Work email</span>
            <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <SubmitButton className="btn block" pendingLabel="Signing in…">
            Sign in
          </SubmitButton>
        </form>

        {/*
          Kept, not replaced. It is the way back in for anybody who has
          forgotten a password, and the only way in for the accounts made
          before passwords existed — several of which are real people using
          this today.
        */}
        <details className="auth-alt">
          <summary className="small muted">Forgotten it, or never set one?</summary>
          <form action={sendMagicLink} className="card">
            {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
            <label className="field">
              <span>Work email</span>
              <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" />
            </label>
            <SubmitButton className="btn secondary block" pendingLabel="Sending…">
              Email me a sign-in link
            </SubmitButton>
          </form>
        </details>
      </main>
      <SiteFooter />
    </>
  );
}
