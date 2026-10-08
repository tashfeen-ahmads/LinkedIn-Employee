import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { AuthAside } from "@/components/auth-aside";
import { PasswordField } from "@/components/password-field";
import { SubmitButton } from "@/components/submit-button";
import { checkEmail, checkPassword, PASSWORD_MIN } from "@/lib/auth-fields";
import { requestAccountEmails } from "@/lib/account-emails";
import { SITE } from "@/lib/site";

/*
 * What `?error=` may say. The action below redirects with a short code, and
 * the page owns the sentence: printing the query string verbatim let anybody
 * write a red banner under our logo, and printing the provider's own message
 * put "AuthApiError: over_email_send_rate_limit" in front of a new customer.
 */
type SignupError = "name" | "email" | "short" | "mismatch" | "exists" | "rate-limit" | "weak" | "failed";

function errorFor(code: string | undefined): React.ReactNode {
  if (!code) return null;
  switch (code as SignupError) {
    case "name":
      return "Tell us your name. It is what a prospect sees the invitation come from.";
    case "email":
      return "That does not look like an email address. Check it and try again.";
    case "short":
      return `Use at least ${PASSWORD_MIN} characters. A short phrase is fine.`;
    case "mismatch":
      return "The two passwords do not match. Both boxes can be shown, so you can check them.";
    case "weak":
      return "That password is too easy to guess. Try a longer phrase.";
    case "rate-limit":
      return "Too many attempts from here in a short time. Wait a few minutes, then try again.";
    case "exists":
      return (
        <>
          There is already an account with that email. <Link href="/login">Sign in</Link>, or{" "}
          <Link href="/forgot">reset your password</Link> if you have forgotten it.
        </>
      );
    default:
      return "Your account could not be created just now. Try again in a minute.";
  }
}

/** A provider refusal, as one of the codes above. Never its own words. */
function signupErrorCode(error: { message?: string; code?: string; status?: number }): SignupError {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (/user_already_exists|email_exists|already (been )?registered|already exists/.test(text)) return "exists";
  if (error.status === 429 || /rate[ _-]?limit|too many/.test(text)) return "rate-limit";
  if (/email_address_invalid|invalid.*email|email.*invalid/.test(text)) return "email";
  if (/weak_password|password/.test(text)) return "weak";
  return "failed";
}

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

  const typed = String(formData.get("email") ?? "").trim();

  /*
   * A refusal hands back what was typed.
   *
   * Every rejection used to redirect to a bare `?error=`, which re-rendered an
   * empty form: fix the one field that was wrong and you retype your name, your
   * email and both passwords. Two rejections in a row and people stop. The
   * password is deliberately not echoed — it would be in the URL bar, the
   * browser history and every access log between here and the CDN.
   */
  const back = (reason: SignupError) => {
    const params = new URLSearchParams({ error: reason });
    if (fullName) params.set("name", fullName);
    if (typed) params.set("email", typed);
    if (invite) params.set("invite", invite);
    redirect(`/signup?${params.toString()}`);
  };

  if (!fullName) back("name");

  const email = checkEmail(typed);
  if (!email.ok) back("email");

  const rawPassword = String(formData.get("password") ?? "");
  const password = checkPassword(rawPassword, String(formData.get("confirm") ?? ""));
  // `checkPassword` has two refusals and they are told apart by the one input
  // that decides between them, rather than by reading its sentence back.
  if (!password.ok) back(rawPassword.length < PASSWORD_MIN ? "short" : "mismatch");

  const supabase = await createClient();

  // `SITE.app`, normalised, so a trailing slash or an unset variable cannot
  // put a broken address in the confirmation email.
  const base = SITE.app;
  const callback = invite
    ? `${base}/auth/callback?invite=${encodeURIComponent(invite)}`
    : `${base}/auth/callback`;

  const { data: created, error } = await supabase.auth.signUp({
    email: (email as { value: string }).value,
    password: (password as { value: string }).value,
    options: {
      emailRedirectTo: callback,
      // Read by the trigger, never by the browser. These are the only fields
      // the form is allowed to put on the account.
      data: { full_name: fullName, address },
    },
  });

  if (error) back(signupErrorCode(error));

  /*
   * Signing up signs you in, when the project lets it.
   *
   * This threw the session away and redirected to a "check your inbox" screen
   * — so somebody who had just chosen a password could not carry on, and the
   * password they set was beside the point: the only way in was still a link
   * in an email. That is the shape of the flow this replaced, wearing a
   * password field.
   *
   * Supabase decides which of the two this is, and it says so in the answer:
   * a session means the address needs no confirming and the person is already
   * signed in, so the only correct next step is the work. No session with a
   * user means the project requires confirmation, and then the inbox really is
   * the next step — reported honestly rather than pretended past, because a
   * screen that says "you are in" over a session that does not exist sends
   * somebody to a login that will refuse them.
   *
   * Read from the response rather than from an environment variable naming
   * the setting: the project is the thing that decides, and a second reading
   * of somebody else's setting is one that can disagree with it.
   */
  // The welcome goes only with a session: without one the address is
  // unproved, and the confirmation link's callback welcomes them instead.
  if (created.session && created.user) await requestAccountEmails(created.user.id);

  if (created.session) {
    // Straight to setting the business up. `/onboarding` sends them on to the
    // app if they somehow already have a workspace, so this cannot strand
    // anybody on a form they have already filled in.
    redirect(invite ? `/invite/${encodeURIComponent(invite)}` : "/onboarding");
  }

  redirect(`/signup?sent=${encodeURIComponent((email as { value: string }).value)}`);
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; invite?: string; name?: string; email?: string }>;
}) {
  const params = await searchParams;
  const error = errorFor(params.error);

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
            <Link href="/">Back to the site</Link>
          </p>
        </main>
        <AuthAside variant="signup" />
        </div>
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
    // Shown back only if it is an address: the query string is anybody's to
    // write, and this sentence sits in the product's own voice.
    const sentCheck = checkEmail(params.sent);
    const sentTo = sentCheck.ok ? sentCheck.value : null;
    return (
      <>
        <SiteHeader />
        <div className="auth-split">
        <main className="auth-page" id="main" tabIndex={-1}>
          <header>
            <h1>Confirm your email</h1>
            <p className="muted">
              We sent a link to{" "}
              {sentTo ? <strong>{sentTo}</strong> : "the address you gave"}. Open it and your account is ready.
              It is what proves the address is yours, so nothing sends until you do.
            </p>
          </header>
          <div className="notice" role="status">
            <p className="small">
              Nothing in your inbox after a minute or two? Check spam, and make sure the address
              above is right. If it is wrong, sign up again with the correct one.
            </p>
          </div>
          <p className="muted small">
            Already confirmed? <Link href="/login">Sign in</Link>
          </p>
        </main>
        <AuthAside variant="signup" />
        </div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <div className="auth-split">
      <main className="auth-page wide" id="main" tabIndex={-1}>
        <header>
          <h1>Create your account</h1>
          <p className="muted">
            Two things: who the messages come from, and how you sign back in. Everything about your
            business is asked once, on the next screen.
          </p>
        </header>

        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}

        {/*
          Two groups, not six boxes in a row.
          Every field used to carry a paragraph justifying itself, so a form of
          six inputs read as a page of prose with slots in it — and the
          business address was asked for here, at onboarding and again on the
          profile, three times for one value. Signup is the moment to get
          somebody in; the detail belongs where it is already asked properly.
          What is left is the smallest set that makes an account: who the
          messages come from, and how to sign back in.
        */}
        <form action={signUp} className="card">
          {params.invite ? <input type="hidden" name="invite" value={params.invite} /> : null}

          <div className="field-group">
            <p className="field-group-label">Who the messages come from</p>

            <label className="field">
              <span>Your name</span>
              <input
                type="text"
                name="fullName"
                required
                autoComplete="name"
                placeholder="Daniel Okafor"
                defaultValue={params.name ?? ""}
              />
              <span className="hint">Yours, not your company&rsquo;s. A prospect reads it on the invitation.</span>
            </label>

          </div>

          <div className="field-group">
            <p className="field-group-label">How you sign back in</p>

            <label className="field">
              <span>Work email</span>
              {/*
                `username`, not `email`: this address is what you sign in
                with, and it is the token a password manager stores as the
                login. It was on the handle field, so managers were saving the
                handle as the identifier and then not offering the address
                back on the sign-in page.
              */}
              <input
                type="email"
                name="email"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="you@company.com"
                defaultValue={params.email ?? ""}
              />
            </label>

            <div className="form-row">
              {/* Both boxes can be read, which is the fix for the most common
                  way a signup is abandoned: typing a passphrase blind into two
                  fields and being told afterwards that they disagree. */}
              <PasswordField
                name="password"
                label="Password"
                minLength={PASSWORD_MIN}
                hint={`At least ${PASSWORD_MIN} characters.`}
              />
              <PasswordField name="confirm" label="Confirm password" minLength={PASSWORD_MIN} />
            </div>
            <span className="hint">
              Length is the only rule. A demand for a capital, a digit and a symbol produces
              &ldquo;Password1!&rdquo;, which every cracking dictionary already has.
            </span>
          </div>

          <div className="notice">
            <p className="small">
              <strong>Works with any LinkedIn account.</strong> With Sales Navigator, NORA can also
              target by seniority and company size and leave out job titles you don&rsquo;t want, so
              your lists are tighter. Without it, lists are broader and you&rsquo;ll review more of
              them. You&rsquo;ll choose on the next step.
            </p>
          </div>

          <SubmitButton className="btn block" pendingLabel="Creating your account…">
            Create account
          </SubmitButton>
        </form>

        <p className="muted small">
          Already have an account? <Link href="/login">Sign in</Link> ·{" "}
          <Link href="/forgot">Forgot password?</Link>
        </p>
      </main>
      <AuthAside variant="signup" />
      </div>
      <SiteFooter />
    </>
  );
}
