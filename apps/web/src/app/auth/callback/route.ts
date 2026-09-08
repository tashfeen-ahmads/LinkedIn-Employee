import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/** Exchanges the magic-link code for a session cookie. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=Missing+sign-in+code`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);

  // An invited user goes back to the invitation rather than being asked to
  // create a workspace they were never meant to own.
  const invite = searchParams.get("invite");
  return NextResponse.redirect(invite ? `${origin}/invite/${invite}` : `${origin}/onboarding`);
}
