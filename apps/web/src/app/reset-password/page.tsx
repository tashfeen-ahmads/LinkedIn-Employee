import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { AuthAside } from "@/components/auth-aside";
import { PasswordField } from "@/components/password-field";
import { SubmitButton } from "@/components/submit-button";
import { checkPassword, PASSWORD_MIN } from "@/lib/auth-fields";

/* `?error=` is a key, never a sentence from the URL. */
const ERRORS: Record<string, string> = {
  short: `Use at least ${PASSWORD_MIN} characters. A short phrase is fine.`,
  mismatch: "The two passwords do not match.",
  failed: "That password could not be saved. Try a different one.",
};
const UNKNOWN_ERROR = "That password could not be saved. Try again.";

/**
 * Choosing a new password, reached from a recovery link (which signed the
 * person in) or by anybody already signed in.
 */
async function setPassword(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  // The signup rule, not a second one written for this page.
  const checked = checkPassword(password, confirm);
  if (!checked.ok) redirect(`/reset-password?error=${password.length < PASSWORD_MIN ? "short" : "mismatch"}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/forgot?error=expired");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/reset-password?error=failed");
  redirect(`/app?notice=${encodeURIComponent("Your password is changed. Use it next time you sign in.")}`);
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isAppConfigured()) redirect("/login");
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/forgot?error=expired");
  const error = params.error
    ? Object.prototype.hasOwnProperty.call(ERRORS, params.error)
      ? ERRORS[params.error]
      : UNKNOWN_ERROR
    : null;

  return (
    <>
      <SiteHeader />
      <div className="auth-split">
        <main className="auth-page" id="main" tabIndex={-1}>
          <header>
            <h1>Choose a new password</h1>
            <p className="muted">For {user.email}.</p>
          </header>
          {error ? (
            <div className="notice danger" role="alert">
              {error}
            </div>
          ) : null}
          <form action={setPassword} className="card">
            {/*
              The account this password belongs to, for the password manager.
              Without a username field beside a new-password field a manager
              saves the new password against nothing, or against whatever it
              guessed, and offers the old one at the next sign-in.
            */}
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={user.email ?? ""}
              readOnly
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <PasswordField
              name="password"
              label="New password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              hint={`At least ${PASSWORD_MIN} characters.`}
            />
            <PasswordField name="confirm" label="Confirm password" autoComplete="new-password" minLength={PASSWORD_MIN} />
            <SubmitButton className="btn block" pendingLabel="Saving…">
              Save new password
            </SubmitButton>
          </form>
        </main>
        <AuthAside />
      </div>
      <SiteFooter />
    </>
  );
}
