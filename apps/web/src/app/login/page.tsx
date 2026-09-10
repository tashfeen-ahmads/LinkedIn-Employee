import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { GoogleGlyph } from "@/components/google-glyph";

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
        <main style={{ padding: "5rem 0" }}>
          <div className="narrow" style={{ maxWidth: 460 }}>
            <h1 style={{ fontSize: "1.9rem" }}>Not open yet</h1>
            <p className="muted">
              We are still setting this up. Trials open once the first campaigns have run under
              supervision — we would rather be late than have the first thing our software does be
              something a stranger receives by mistake.
            </p>
            <p className="muted">
              <a href="/">Back to the site</a>
            </p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main style={{ padding: "5rem 0" }}>
        <div className="narrow" style={{ maxWidth: 430 }}>
          <h1 style={{ fontSize: "1.9rem" }}>Start your trial</h1>
          <p className="muted">
            We will email you a sign-in link. No password to remember.
          </p>

          {params.sent ? (
            <div className="notice" style={{ marginBottom: "1.25rem" }}>
              Check your inbox. The link is valid for one hour.
            </div>
          ) : null}
          {params.error ? (
            <div className="notice danger" style={{ marginBottom: "1.25rem" }}>
              {params.error}
            </div>
          ) : null}

          <form action={signInWithGoogle} className="stack-3" style={{ marginBottom: "var(--space-5)" }}>
            {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
            <button className="btn secondary block" type="submit">
              <GoogleGlyph />
              Continue with Google
            </button>
          </form>

          <div className="or-rule">
            <span className="tiny subtle">or use an email link</span>
          </div>

          <form action={sendMagicLink} className="card">
            {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
            <label className="field">
              <span>Work email</span>
              <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" />
            </label>
            <button className="btn" type="submit" style={{ width: "100%", justifyContent: "center" }}>
              Email me a link
            </button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
