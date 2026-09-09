/**
 * Entry point for `pnpm --filter @le/db seed`.
 *
 * Refuses to run against a database it was not pointed at explicitly, because
 * seeding writes a workspace and a user, and the service-role key it needs
 * bypasses row-level security entirely.
 */
import { createClient } from "@supabase/supabase-js";
import { seedDemo } from "./index.js";
import type { Database } from "../database.types.js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "For a local stack: SUPABASE_URL=http://127.0.0.1:54321 with the service_role key from `supabase status`.",
  );
  process.exit(1);
}

const client = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await seedDemo(client);

console.log(`
Seeded the demo workspace.

  workspace   ${result.workspaceId}
  sign in as  ${result.email}
  campaign    ${result.campaignId}

  ${result.counts.prospects} prospects · ${result.counts.conversations} conversations ·
  ${result.counts.messages} messages · ${result.counts.meetings} meeting booked

One reply is waiting in the inbox with a pricing question the agent refused to
answer on its own — that hold is the thing worth showing.

Sign in at /login with that address; the magic link appears in the local
Inbucket at http://127.0.0.1:54324 when running against a local stack.
`);
