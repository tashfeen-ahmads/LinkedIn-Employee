import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DB_SCHEMA, type Db } from "@le/db";
import { pinRequestOrigin } from "./request-origin";

/** Request-scoped client. Runs as the signed-in user, so RLS applies. */
export async function createClient(): Promise<Db> {
  // Every server action reaches the session through here, so this is the one
  // place that keeps a Save's redirect on the host holding the cookie.
  await pinRequestOrigin();
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: DB_SCHEMA },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component, which cannot set cookies. The
            // middleware refreshes the session before the render, so the
            // tokens read here are already current.
          }
        },
      },
    },
  );
}
