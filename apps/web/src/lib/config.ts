/**
 * Whether there is a database behind the marketing site yet.
 *
 * The landing page is static and can be live before anything else exists. Every
 * screen behind it needs Supabase, and a Supabase client built from undefined
 * credentials throws on the first request — so an unprovisioned deployment
 * answers a sign-in attempt with a 500 rather than with an explanation.
 *
 * A page that says plainly it is not open yet is a better thing to hand a
 * colleague than a stack trace.
 */
export function isAppConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
