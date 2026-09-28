import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { GoogleGlyph } from "@/components/google-glyph";
import { SubmitButton } from "@/components/submit-button";
import { checkEmail, checkPassword, checkUsername, PASSWORD_MIN } from "@/lib/auth-fields";

/**
 * Creating an account, as its own page and its own act.
 *
 * Sign-in and sign-up shared one form and one button: an unknown email quietly
 * became an account, a known one got a session. That is tidy and it is the
 * wrong shape for this product. Nothing was ever collected but an address, so
 * every fact about a person had to be asked for again later, on a settings
 * screen they had to go and find — which is the same disease the profile
 * rebuild was about. A product that keeps asking for things it could have
 * gathered once feels unfinished however good each screen is.
 *
 * So signing up asks who you are, once, and the email is confirmed before the
 * account can do anything. Supabase sends that mail; the extra fields ride in
 * `raw_user_meta_data` and the `handle_new_user` trigger copies them into
 * `profiles` (migration 0037). The browser never writes its own profile row.
 */
async function signUp(formData: FormData) {
  "use server";
  const fullName = String(formData.get("fullName") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const invite = String(formData.get("invite") ?? "").trim();

  const back = (reason: string) =>
    redirect(`/signup?error=${encodeURIComponent(reason)}${invite ? `&invite=${encodeURIComponent(invite)}` : ""}`);

  if (!fullName) back("Tell us your name.");

  const email = checkEmail(String(formData.get("email") ?? ""));
  if (!email.ok) back(email.reason);

  const username = checkUsername(String(formData.get("username") ?? ""));
  if (!username.ok) back(username.reason);

  const password = checkPassword(
    String(formData.get("password") ?? ""),
    String(formData.get("confirm") ?? ""),
  );
  if (!password.ok) back(password.reason);

  const supabase = await createClient();

  /*
   * The username is checked before the account is made, because the unique
   * index would otherwise report itself as a failed signup.
   *
   * It is not a guarantee — two people can pass this check in the same second
   * and the index still decides — which is exactly why the constraint exists
   * underneath. This only turns the common case into a sentence somebody can
   * act on instead of "duplicate key value violates unique constraint".
   */
  const { data: taken } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", (username as { value: string }).value)
    .maybeSingle();
  if (taken) back("That username is taken. Try another.");

  const base = process.env.APP_URL ?? "http://localhost:3000";
  const callback = invite
    ? `${base}/auth/callback?invite=${encodeURIComponent(invite)}`
    : `${base}/auth/callback`;

  const { error } = await supabase.auth.signUp({
    email: (email as { value: string }).value,
    password: (password as { value: string }).value,
    options: {
      emailRedirectTo: callback,
      // Read by the trigger, never by the browser. These are the only fields
      // the form is allowed to put on the account.
      data: { full_name: fullName, username: (username as { value: string }).value, address },
    },
  });

  if (error) back(error.message);

  redirect(`/signup?sent=${encodeURIComponent((email as { value: string }).value)}`);
}

/** Google, which confirms the address by definition and needs no password. */
async function signUpWithGoogle(formData: FormData) {
  "use server";
  const invite = String(formData.get("invite") ?? "").trim();
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const callback = invite
    ? `${base}/auth/callback?invite=${encodeURIComponent(invite)}`
    : `${base}/auth/callback`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback, queryParams: { access_type: "offline", prompt: "consent" } },
  });
  if (error || !data?.url) redirect(`/signup?error=${encodeURIComponent(error?.message ?? "Google sign-in is unavailable.")}`);
  redirect(data.url);
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; invite?: string }>;
}) {
  const params = await searchParams;

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
            <Link href="/">Back to the site</Link>
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  /*
   * After the mail goes out the form is gone, not merely disabled.
   *
   * A filled form still on screen beside "check your inbox" invites a second
   * submit, and a second signup for the same address is a second confirmation
   * mail and a question about which link is the real one.
   */
  if (params.sent) {
    return (
      <>
        <SiteHeader />
        <main className="auth-page">
          <header>
            <h1>Confirm your email</h1>
            <p className="muted">
              We sent a link to <strong>{params.sent}</strong>. Open it and your account is ready —
              it is what proves the address is yours, so nothing sends until you do.
            </p>
          </header>
          <div className="notice">
            <p className="small">
              Nothing in your inbox after a minute or two? Check spam, and make sure the address
              above is right — if it is wrong, sign up again with the correct one.
            </p>
          </div>
          <p className="muted small">
            Already confirmed? <Link href="/login">Sign in</Link>
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
          <h1>Create your account</h1>
          <p className="muted">
            Seven days free. We ask for this once — it is what the agent writes as, and what your
            profile is made of.
          </p>
        </header>

        {params.error ? <div className="notice danger">{params.error}</div> : null}

        <form action={signUpWithGoogle}>
          {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}
          <button className="btn secondary block" type="submit">
            <GoogleGlyph />
            Continue with Google
          </button>
        </form>

        <div className="or-rule">
          <span className="tiny subtle">or with an email and password</span>
        </div>

        <form action={signUp} className="card">
          {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}

          <label className="field">
            <span>Your name</span>
            <input type="text" name="fullName" required autoComplete="name" placeholder="Sam Patel" />
            <span className="hint">
              What a prospect sees the invitation come from. It is your name, not your company&rsquo;s.
            </span>
          </label>

          <label className="field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              required
              autoComplete="username"
              placeholder="sampatel"
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9._-]+"
            />
            <span className="hint">Letters, numbers, dots, underscores or hyphens. No spaces.</span>
          </label>

          <label className="field">
            <span>Work email</span>
            <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" />
            <span className="hint">We send a confirmation link here before the account can do anything.</span>
          </label>

          <label className="field">
            <span>Address</span>
            <textarea
              name="address"
              rows={2}
              autoComplete="street-address"
              placeholder="12 Mill Lane, Bristol BS1 4ST, United Kingdom"
            />
            <span className="hint">
              Your business address. It goes on invoices and it is what tells us which rules apply
              to you — optional now, and on your profile whenever you want to change it.
            </span>
          </label>

          <div className="form-row">
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                required
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
              />
            </label>
            <label className="field">
              <span>Again</span>
              <input type="password" name="confirm" required autoComplete="new-password" minLength={PASSWORD_MIN} />
            </label>
          </div>
          <span className="tiny subtle">
            At least {PASSWORD_MIN} characters. A short phrase you will remember beats a short one
            you will not.
          </span>

          <SubmitButton className="btn block" pendingLabel="Creating your account…">
            Create account
          </SubmitButton>
        </form>

        <p className="muted small">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
