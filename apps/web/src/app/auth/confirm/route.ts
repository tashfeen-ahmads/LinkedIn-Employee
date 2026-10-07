import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isAppConfigured } from "@/lib/config";
import { seeOther } from "@/lib/see-other";

/**
 * Opens a one-time link from a recovery email.
 *
 * The token is verified here, on the server, and the session lands in cookies —
 * the hosted link that puts the session in a URL fragment cannot be read by a
 * server at all. Only paths inside this app are followed afterwards.
 */
const ALLOWED_NEXT = new Set(["/reset-password", "/app"]);

export async function GET(request: NextRequest) {
  if (!isAppConfigured()) return seeOther("/login");
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const next = params.get("next") ?? "/reset-password";
  if (!tokenHash || type !== "recovery") {
    return seeOther(`/forgot?error=${encodeURIComponent("That link is not complete. Ask for a new one below.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    return seeOther(
      `/forgot?error=${encodeURIComponent("That link has expired or was already used. Ask for a new one below.")}`,
    );
  }
  return seeOther(ALLOWED_NEXT.has(next) ? next : "/reset-password");
}
