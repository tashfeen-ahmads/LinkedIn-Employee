import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { requestAccountEmails } from "@/lib/account-emails";

/** Exchanges the magic-link code for a session cookie. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  if (!isAppConfigured()) return NextResponse.redirect(`${origin}/login`);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=Missing+sign-in+code`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);

  // The address is proved now, so this is when somebody who had to confirm is
  // welcomed. Once-only in the worker, so a returning sign-in sends nothing.
  if (data.user) await requestAccountEmails(data.user.id);

  // An invited user goes back to the invitation rather than being asked to
  // create a workspace they were never meant to own.
  const invite = searchParams.get("invite");
  return NextResponse.redirect(invite ? `${origin}/invite/${invite}` : `${origin}/onboarding`);
}
