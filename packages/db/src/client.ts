import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

export type Db = SupabaseClient<Database>;

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
  return createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
