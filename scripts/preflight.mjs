#!/usr/bin/env node
/**
 * Is this deployment actually ready to send?
 *
 * Provisioning this product means a Supabase project, a Redis, a worker host,
 * four OAuth apps, Unipile, Stripe and Resend — and the failure mode is not a
 * crash. It is a rep completing a hosted login and then nothing ever sending,
 * with no error on any screen, because one webhook URL was wrong.
 *
 * So this asks every question that has a checkable answer, and says what to do
 * about each one it does not like.
 *
 *   node scripts/preflight.mjs                 # check what is in the environment
 *   node scripts/preflight.mjs --worker <url>  # also probe a running worker
 */

const args = process.argv.slice(2);
const workerFlag = args.indexOf("--worker");
const workerUrl = workerFlag !== -1 ? args[workerFlag + 1] : process.env.WORKER_URL;

const results = [];
const record = (level, name, detail, fix) => results.push({ level, name, detail, fix });
const ok = (name, detail) => record("ok", name, detail);
const warn = (name, detail, fix) => record("warn", name, detail, fix);
const fail = (name, detail, fix) => record("fail", name, detail, fix);

/* ------------------------------------------------------------ credentials */

const REQUIRED = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    why: "Nothing behind the landing page works without it.",
    fix: "Supabase → Project Settings → API → Project URL",
    check: (v) => (/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v) ? null : "does not look like a project URL"),
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    why: "The worker bypasses RLS and filters by workspace itself.",
    fix: "Supabase → Project Settings → API → service_role. Never expose this to a browser.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    why: "Every agent call.",
    fix: "console.anthropic.com → API keys",
    check: (v) => (v.startsWith("sk-ant-") ? null : "does not start with sk-ant-"),
  },
  { key: "REDIS_URL", why: "The job queues.", fix: "Upstash, Railway or a Redis on the worker host" },
  { key: "UNIPILE_DSN", why: "Reaching LinkedIn at all.", fix: "Unipile dashboard → API → DSN" },
  { key: "UNIPILE_ACCESS_TOKEN", why: "Reaching LinkedIn at all.", fix: "Unipile dashboard → API" },
];

const IMPORTANT = [
  {
    key: "UNIPILE_WEBHOOK_SECRET",
    why: "Without it the worker refuses every inbound reply AND every account connection — deliberately, because an unsigned webhook could bind a stranger's LinkedIn account to a rep.",
    fix: "Set the same secret in Unipile's webhook config and here.",
  },
  {
    key: "INTERNAL_API_SECRET",
    why: "Authenticates the web app to the worker. Missing means the worker answers 503 to every job.",
    fix: "openssl rand -hex 32",
    check: (v) => (v.length >= 32 ? null : "must be at least 32 characters"),
  },
  {
    key: "CREDENTIALS_KEY",
    why: "Encrypts OAuth tokens before they are stored. Missing means the worker cannot save a connection.",
    fix: "openssl rand -hex 32",
    check: (v) => (/^[0-9a-f]{64}$/i.test(v) ? null : "must be exactly 64 hex characters"),
  },
  {
    key: "WORKER_URL",
    why: "The redirect target for four OAuth apps and the Unipile webhooks. A wrong value here is the classic silent failure.",
    fix: "The worker's public https URL, no trailing slash.",
    check: (v) =>
      v.startsWith("http://localhost")
        ? "still points at localhost — OAuth callbacks and webhooks will never arrive"
        : v.endsWith("/")
          ? "has a trailing slash; the code appends its own"
          : null,
  },
  {
    key: "APP_URL",
    why: "Where sign-in links and emails point.",
    fix: "The web app's public https URL.",
    check: (v) => (v.startsWith("http://localhost") ? "still points at localhost" : null),
  },
];

const OPTIONAL = [
  ["STRIPE_SECRET_KEY", "Billing. Trials work without it; nobody can subscribe."],
  ["STRIPE_WEBHOOK_SECRET", "Without it a completed checkout never activates the plan."],
  ["RESEND_API_KEY", "The digest and the account-paused alert. Silent without it."],
  ["GOOGLE_CLIENT_ID", "Calendar. Without it the agent offers to send times rather than proposing any."],
  ["HUBSPOT_CLIENT_ID", "CRM sync."],
];

for (const item of REQUIRED) {
  const value = process.env[item.key];
  if (!value) fail(item.key, item.why, item.fix);
  else {
    const problem = item.check?.(value);
    problem ? fail(item.key, problem, item.fix) : ok(item.key, "set");
  }
}

for (const item of IMPORTANT) {
  const value = process.env[item.key];
  if (!value) warn(item.key, item.why, item.fix);
  else {
    const problem = item.check?.(value);
    problem ? fail(item.key, problem, item.fix) : ok(item.key, "set");
  }
}

for (const [key, why] of OPTIONAL) {
  process.env[key] ? ok(key, "set") : warn(key, why, "Optional for a first campaign.");
}

/* ------------------------------------------- things that can be asked live */

const mock = process.env.LINKEDIN_PROVIDER === "mock";
if (mock) {
  warn(
    "LINKEDIN_PROVIDER",
    "set to mock — nothing will reach a real LinkedIn account",
    "Unset it, or set it to unipile, when you mean to send for real.",
  );
}

async function probe(name, url, expect) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await response.text();
    if (!response.ok) return fail(name, `HTTP ${response.status}`, `Check ${url} is reachable.`);
    if (expect && !body.includes(expect)) return fail(name, `unexpected body from ${url}`);
    ok(name, `answered from ${url}`);
  } catch (error) {
    fail(name, `${error instanceof Error ? error.message : error}`, `Is ${url} up and public?`);
  }
}

if (workerUrl && !workerUrl.startsWith("http://localhost")) {
  await probe("worker /health", `${workerUrl.replace(/\/$/, "")}/health`, '"ok"');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl && serviceKey) {
  try {
    // One row from a table only the migrations create. A 404 here means the
    // project exists but nothing has been applied to it.
    const response = await fetch(`${supabaseUrl}/rest/v1/workspaces?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404 || response.status === 400) {
      fail("migrations", "the workspaces table is not there", "Apply packages/db/supabase/migrations in order, 0001 first.");
    } else if (!response.ok) {
      fail("supabase", `HTTP ${response.status}`, "Check the service role key.");
    } else {
      ok("migrations", "schema is applied and reachable");
    }
  } catch (error) {
    fail("supabase", `${error instanceof Error ? error.message : error}`, "Is the project awake? Paused projects refuse connections.");
  }
}

/* ------------------------------------------------------------------ report */

const icon = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };
const order = { fail: 0, warn: 1, ok: 2 };
results.sort((a, b) => order[a.level] - order[b.level]);

console.log("");
for (const r of results) {
  console.log(`[${icon[r.level]}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  if (r.fix && r.level !== "ok") console.log(`          ↳ ${r.fix}`);
}

const failures = results.filter((r) => r.level === "fail").length;
const warnings = results.filter((r) => r.level === "warn").length;

console.log("");
if (failures) {
  console.log(`${failures} blocking, ${warnings} worth a look. This deployment cannot send yet.`);
} else if (warnings) {
  console.log(`Nothing blocking, ${warnings} worth a look before a real campaign.`);
} else {
  console.log("Ready. Run the classification eval next, then one account in approval mode.");
}
console.log("");

process.exit(failures ? 1 : 0);
