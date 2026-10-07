import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { AuthAside } from "@/components/auth-aside";
import { PasswordField } from "@/components/password-field";
import { SubmitButton } from "@/components/submit-button";
import { checkPassword, PASSWORD_MIN } from "@/lib/auth-fields";

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
  if (!checked.ok) redirect(`/reset-password?error=${encodeURIComponent(checked.reason)}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/forgot?error=${encodeURIComponent("That link has expired. Ask for a new one below.")}`);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/reset-password?error=${encodeURIComponent("That password could not be saved. Try a different one.")}`);
  redirect(`/app?notice=${encodeURIComponent("Your password is changed. Use it next time you sign in.")}`);
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isAppConfigured()) redirect("/login");
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/forgot?error=${encodeURIComponent("That link has expired. Ask for a new one below.")}`);

  return (
    <>
      <SiteHeader />
      <div className="auth-split">
        <main className="auth-page">
          <header>
            <h1>Choose a new password</h1>
            <p className="muted">For {user.email}.</p>
          </header>
          {params.error ? <div className="notice danger">{params.error}</div> : null}
          <form action={setPassword} className="card">
            <PasswordField
              name="password"
              label="New password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              hint={`At least ${PASSWORD_MIN} characters.`}
            />
            <PasswordField name="confirm" label="Type it again" autoComplete="new-password" minLength={PASSWORD_MIN} />
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
