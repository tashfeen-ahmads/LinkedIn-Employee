import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

/**
 * The Postgres schema every table lives in.
 *
 * Not `public`. This deployment shares a Supabase project with an unrelated
 * product whose tables are also called `memberships`, `conversations` and
 * `messages`, and one schema for both would have meant one of them losing.
 * `scripts/schema-install.mjs` installs into this name; every client below
 * reads it; PostgREST has to expose it (Dashboard → Settings → API → Exposed
 * schemas) or every request 404s in a way that looks exactly like a failed
 * migration.
 *
 * One constant so the two can never drift apart.
 */
export const DB_SCHEMA = "le";

export type Db = SupabaseClient<Database, typeof DB_SCHEMA>;

/**
 * Service-role client for the worker. Bypasses RLS, so every query must filter
 * by workspace_id explicitly. Never import this from browser code.
 */
export function createServiceClient(url?: string, key?: string): Db {
  const supabaseUrl = url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient<Database, typeof DB_SCHEMA>(supabaseUrl, serviceKey, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
