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

/**
 * Magic-link sign in. No passwords to store, and the same form serves signup
 * and login: a new email gets an account, an existing one gets a session.
 */
async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const invite = String(formData.get("invite") ?? "").trim();
  if (!email) redirect("/login?error=Enter+your+work+email");

  // `SITE.app`, normalised: a trailing slash on APP_URL produced
  // `https://app…//auth/callback`, which the provider refuses as a redirect.
  const base = SITE.app;
  // An invited user should land back on their invitation, not on onboarding.
  const callback = invite
    ? `${base}/auth/callback?invite=${encodeURIComponent(invite)}`
    : `${base}/auth/callback`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callback } });

  redirect(error ? `/login?error=${encodeURIComponent(error.message)}` : "/login?sent=1");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; notice?: string; invite?: string }>;
}) {
  const params = await searchParams;

  // Deployed ahead of its database, which is how the marketing site gets to be
  // live first. Saying so is better than a sign-in form that returns a 500.
  if (!isAppConfigured()) {
    return (
      <>
        <SiteHeader />
        <div className="auth-split">
        <main className="auth-page">
          <header>
            <h1>Not open yet</h1>
            <p className="muted">
              We are still setting this up. Sign-ups open once the first campaigns have run under
              supervision — we would rather be late than have the first thing our software does be
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
        {/* Good news in its own colour: a confirmed address arriving here is
            a success, and the red banner told people their signup had failed. */}
        {params.notice ? <div className="notice accent" role="status">{params.notice}</div> : null}
        {params.error ? <div className="notice danger">{params.error}</div> : null}

        <form action="/auth/sign-in" method="post" className="card">
          {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
          <label className="field">
            <span>Work email</span>
            <input type="email" name="email" required autoComplete="username" placeholder="you@company.com" />
          </label>
          <PasswordField name="password" label="Password" autoComplete="current-password" />
          <PostButton className="btn block" pendingLabel="Signing in…">
            Sign in
          </PostButton>
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
              <input type="email" name="email" required autoComplete="username" placeholder="you@company.com" />
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
