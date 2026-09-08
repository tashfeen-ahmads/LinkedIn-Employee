import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { SiteFooter, SiteHeader } from "@/components/marketing";

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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; invite?: string }>;
}) {
  const params = await searchParams;

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
