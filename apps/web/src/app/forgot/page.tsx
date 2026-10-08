import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import { AuthAside } from "@/components/auth-aside";
import { SubmitButton } from "@/components/submit-button";
import { callWorker } from "@/lib/worker";

/*
 * What `?error=` may say. Printed verbatim it was a banner anybody could
 * write; now it is a key. Codes come from this page and /reset-password; the
 * two sentences /auth/confirm sends are matched exactly. Anything else gets a
 * plain sentence.
 */
const ERRORS: Record<string, string> = {
  identifier: "Enter your email address or username.",
  expired: "That link has expired. Ask for a new one below.",
  "That link is not complete. Ask for a new one below.": "That link is not complete. Ask for a new one below.",
  "That link has expired or was already used. Ask for a new one below.":
    "That link has expired or was already used. Ask for a new one below.",
};
const UNKNOWN_ERROR = "That link did not work. Ask for a new one below.";

/**
 * Locked out: a new password, or which address you signed up with.
 *
 * Both answers arrive by email, to the address typed, and this page says the
 * same thing whether or not an account exists — a reset form that answers "no
 * such account" is a way to find out who is a customer.
 */
async function recover(formData: FormData) {
  "use server";
  const identifier = String(formData.get("identifier") ?? "").trim();
  const kind = formData.get("kind") === "signin" ? "signin" : "password";
  if (!identifier) redirect(`/forgot?kind=${kind}&error=identifier`);
  // The answer is not passed on: the page says the same thing either way.
  await callWorker("/account/recover", { identifier, kind }, 20_000);
  redirect(`/forgot?kind=${kind}&sent=1`);
}

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const kind = params.kind === "signin" ? "signin" : "password";
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
            <h1>{kind === "signin" ? "Which email did I use?" : "Reset your password"}</h1>
            <p className="muted">
              {kind === "signin"
                ? "Enter any email address you might have used, or your username. We will email you which address opens your workspace."
                : "Enter your email address or username and we will email you a link to choose a new password."}
            </p>
          </header>

          {params.sent ? (
            <div className="notice accent" role="status">
              If that matches an account, the email is on its way. Check your inbox and spam folder.
              The link works once and expires in an hour.
            </div>
          ) : null}
          {error ? (
            <div className="notice danger" role="alert">
              {error}
            </div>
          ) : null}

          <form action={recover} className="card">
            <input type="hidden" name="kind" value={kind} />
            <label className="field">
              <span>Email or username</span>
              <input
                name="identifier"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="you@company.com"
              />
            </label>
            <SubmitButton className="btn block" pendingLabel="Sending…">
              {kind === "signin" ? "Email me my sign-in" : "Email me a reset link"}
            </SubmitButton>
          </form>

          <p className="small muted">
            {kind === "signin" ? (
              <Link href="/forgot">Forgot your password instead?</Link>
            ) : (
              <Link href="/forgot?kind=signin">Not sure which email you used?</Link>
            )}{" "}
            · <Link href="/login">Back to sign in</Link>
          </p>
        </main>
        <AuthAside />
      </div>
      <SiteFooter />
    </>
  );
}
