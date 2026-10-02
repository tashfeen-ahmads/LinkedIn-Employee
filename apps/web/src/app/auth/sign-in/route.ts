import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";

/*
 * Password sign-in, as a plain form post.
 *
 * It was a server action that redirected to /app, which leaves the browser's
 * router to fetch the dashboard. When that client-side step failed the person
 * was signed in at the database and still looking at the login page — a new
 * customer reported "it won't let me log in" with every one of their sign-ins
 * succeeding. A 303 is a full page load: nothing of ours has to run in the
 * browser for it to arrive.
 *
 * The refusal is one sentence for both halves: "no account with that email"
 * and "wrong password" told apart is a way to learn which addresses exist.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const invite = String(form.get("invite") ?? "").trim();
  const q = invite ? `&invite=${encodeURIComponent(invite)}` : "";
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);

  if (!email || !password) return go(`/login?error=${encodeURIComponent("Enter your email and password.")}${q}`);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // An unconfirmed address is the one case worth naming: the password is
    // right and the mail is sitting unopened.
    const unconfirmed = /confirm/i.test(error.message);
    return go(
      `/login?error=${encodeURIComponent(
        unconfirmed
          ? "Open the confirmation link we emailed you first — it is what proves the address is yours."
          : "That email and password do not match an account.",
      )}${q}`,
    );
  }

  return go(invite ? `/invite/${encodeURIComponent(invite)}` : "/app");
}
