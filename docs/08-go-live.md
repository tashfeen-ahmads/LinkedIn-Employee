# Going live, and warming the first account

`docs/07-deployment.md` describes the shape of a deployment. This is the
ordered list for *this* one — the accounts, the values, and the five weeks that
follow.

Two things are true of every step below. Nothing sends until a human approves a
customer profile and launches a campaign, and nothing sends faster than
`packages/shared/src/constants.ts` allows. Neither is a setting you will find in
a dashboard.

---

## What is already done

| Piece | State |
| --- | --- |
| Database | Installed. Supabase project `presence-prod`, schema `le` — 21 tables, RLS on all of them, 45 policies. |
| Frontend | Deploys on every push to `claude/linkedin-sales-enablement-cpzkyu` → `lnkdn-agentic-employees.netlify.app`. Supabase URL, anon key, site URL and app URL are set. |
| Backend blueprint | `render.yaml` at the repo root. Not yet deployed — needs a Render account. |
| Code | 419 tests, 82 mutations, CI green. `pnpm test` needs no network and no key. |

### Why the schema is `le` and not `public`

`presence-prod` already holds another product's data — two organizations, two
brands, fourteen content items — and its own `memberships`, `conversations` and
`messages` tables. Ours live in a separate Postgres schema so neither can see
the other. `scripts/schema-install.mjs` generates the whole schema for a named
target; `DB_SCHEMA` in `packages/db/src/client.ts` is what every client reads.

One consequence to know about: **Supabase Auth is per project, not per schema.**
The two users already in `auth.users` can sign in to this app. They will land on
`/onboarding` with no workspace, which is harmless, but it is a shared front
door and worth remembering before the first customer demo.

---

## What only you can do

Each of these needs an account I have no credentials for. In this order.

### 1. Expose the `le` schema to PostgREST — 2 minutes

Already applied in-database:

```sql
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, le';
```

I could not verify it took effect: outbound HTTPS from this session cannot reach
`*.supabase.co`. **Confirm it in the dashboard** — Supabase → Settings → API →
Exposed schemas should list `le`. Add it there if it does not.

This is the single most misleading failure in the whole list: without it every
request returns 404, which reads exactly like a migration that never ran.
`node scripts/preflight.mjs` tells the two apart.

### 2. Supabase Auth redirect URLs — 2 minutes

Authentication → URL Configuration:

- Site URL: `https://lnkdn-agentic-employees.netlify.app`
- Redirect URLs: add `https://lnkdn-agentic-employees.netlify.app/**`

For Google sign-in, Authentication → Providers → Google, with a Google Cloud
OAuth client whose authorized redirect URI is
`https://eurlrgolgntdngyaexqr.supabase.co/auth/v1/callback`.

### 3. OpenAI key — 5 minutes

`platform.openai.com` → API keys. The agents run on `gpt-5` for anything a
prospect reads and `gpt-5-mini` for classification and fit scoring
(`MODELS` in `packages/shared/src/constants.ts`).

> Check the two prices in `packages/shared/src/pricing.ts` against the published
> rates before quoting anyone a cost per meeting. They are the one thing in this
> repo that changes without anybody touching it, and a stale number there makes
> `/app/usage` confidently wrong.

Setting `ANTHROPIC_API_KEY` instead switches the whole product to Claude with no
code change — the provider is chosen by whichever key exists
(`createLlmClient`). Setting neither stops the worker at boot rather than at the
first signup.

### 4. Unipile — 30 minutes, and the long pole

`unipile.com`, paid. You need `UNIPILE_DSN` and `UNIPILE_ACCESS_TOKEN`, and a
webhook secret you invent yourself:

```bash
openssl rand -hex 32   # UNIPILE_WEBHOOK_SECRET
openssl rand -hex 32   # CREDENTIALS_KEY — must be exactly 64 hex characters
```

In Unipile's dashboard, point two webhooks at the worker once it has a URL:

| Event | URL |
| --- | --- |
| Messaging | `<WORKER_URL>/webhooks/unipile` |
| Account status | `<WORKER_URL>/webhooks/unipile/accounts` |

Both must carry the same secret you set as `UNIPILE_WEBHOOK_SECRET`. **A
missing secret rejects every delivery, deliberately.** A forged account webhook
would bind a stranger's LinkedIn account to a rep's row and send every campaign
message from it.

### 5. Render — 15 minutes

Render → New → Blueprint → this repository. `render.yaml` creates the worker and
a paid Redis (`noeviction`: the free tier evicts under memory pressure, which
for a job queue means losing queued sends with no error anywhere).

Render prompts for every `sync: false` value:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://eurlrgolgntdngyaexqr.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role |
| `OPENAI_API_KEY` | step 3 |
| `UNIPILE_DSN`, `UNIPILE_ACCESS_TOKEN`, `UNIPILE_WEBHOOK_SECRET` | step 4 |
| `CREDENTIALS_KEY` | the second `openssl` line above |
| `APP_URL` | `https://lnkdn-agentic-employees.netlify.app` |
| `RESEND_API_KEY`, `EMAIL_FROM` | step 6 |
| `SENTRY_DSN` | optional, worker only |

`INTERNAL_API_SECRET` is generated by Render. Copy it out of the dashboard: the
web app needs the same value (step 7), and a mismatch makes the worker answer
503 to every job the web app dispatches.

### 6. Resend — 15 minutes, mostly DNS

`resend.com` → add your sending domain → add the DKIM and SPF records it gives
you → wait for verification. Then `EMAIL_FROM` as
`LinkedIn Employee <hello@yourdomain.com>`.

Sending from an unverified domain is what puts the welcome email in spam, and
the first email a customer never sees is the one explaining that the agent is
already working.

### 7. Netlify — 5 minutes

Netlify → the project → Environment variables. Two more, both secret:

- `WORKER_URL` — the Render URL from step 5, no trailing slash
- `INTERNAL_API_SECRET` — the value Render generated

Then redeploy. Everything else is already set.

### 8. Preflight

```bash
node scripts/preflight.mjs
```

Run it with the production environment loaded. It checks every variable, says
what each is for and where to get it, probes the worker's `/health`, and asks
the database for one row from `le.workspaces` — which distinguishes "migrations
not applied" from "wrong key" from "schema not exposed". It exits non-zero while
anything is blocking.

### 9. The eval, before the first real campaign

```bash
OPENAI_API_KEY=sk-... pnpm --filter @le/agents eval:classify
```

This has **never been run**. It measures needs-human recall on the labelled set
in `packages/agents/evals/` — of the messages a human must handle, how many the
gate actually stopped. It exits non-zero below 0.95 and it costs real money
(one classifier call per case).

Run it on the provider you are actually deploying. A number measured on Claude
says nothing about a deployment running GPT-5, and this is the number that
decides whether autopilot is ever safe to offer.

---

## Then: warming the first account

One LinkedIn account, in approval mode, ten invitations a day. That is not a
cautious way to test — it is the only test that means anything, and here is why.

### What the warm-up actually is

`dailyInviteCap` ramps from 10 to 35 over 35 days from `connected_at`:

| Day | Invitations/day |
| --- | --- |
| 0–1 | 10 |
| 7 | 15 |
| 14 | 20 |
| 21 | 25 |
| 28 | 30 |
| 35+ | 35 |

Under a hard ceiling of 100 invitations per week, all campaigns combined, and
50 messages a day. Two actions on one account are never closer than two minutes,
with up to nine minutes of jitter, and nothing sends outside the rep's working
hours.

The account you connect on day one **cannot** send 35 invitations, whatever the
campaign says. That is the point. Arriving at volume on day one is the fastest
way to lose a LinkedIn account, and a restricted account is not a setback — it
is the rep's own professional identity, which they need on Monday.

### What "the actual test" means

Approval mode means every reply the agent writes waits in `/app/inbox` for a
click. Nobody is trusting the model with a customer relationship yet. What you
are measuring in those first two weeks is whether you *would have* clicked send:

- Of the drafts you approved, how many did you edit first, and what did you
  change? Consistent edits are a prompt problem, not a model problem.
- Of the conversations the gate held for a human, was it right to? A hold on
  something obviously routine is a gate that is too tight; a pricing question
  answered by the agent is a gate that is too loose, and that one you find by
  reading every sent message for a fortnight.
- Did anything reach someone on the exclusion list, or after "remove me"? This
  must be zero. It is checked deterministically and immediately before each
  send, and it is the one number that is not a trade-off.

Ten a day for two weeks is roughly 100 invitations — enough to see acceptance
rate, reply rate and the first few meetings, and small enough that a bad
connection note costs you a hundred impressions rather than a thousand.

### The first fortnight, day by day

**Day 0.** Sign up. The Strategy Agent reads your site and writes a business
profile and three to five customer profiles. Read them — this is the step
everything else inherits, and an agent that has misread what you sell writes
plausible copy aimed at the wrong people. Approve one profile.

Connect the LinkedIn account on `/app/team`. Sign-in happens on LinkedIn's own
hosted page; we never see the password. `connected_at` is set here, and it is
day 0 of the ramp — connect it before you need it.

Add one page of product facts on `/app/knowledge`. The agent may state nothing
else. Without it every product question a prospect asks lands in your inbox.

**Day 1.** Build the first campaign. Read all four messages and every name on
the list. Cut anyone you would not message yourself — that judgement is the
thing being calibrated, and it is cheaper to apply now than to apologise for
later. Launch.

**Days 1–5.** Ten invitations a day, inside working hours, at least two minutes
apart. Acceptances are detected by a nightly poll, so a follow-up can land up to
a day after its configured delay — Unipile exposes no acceptance webhook.

**Days 5–14.** Replies start. Every draft waits for you. Approve, edit or
reject, and keep a note of what you changed. `/app/usage` shows cost per booked
meeting and the cached-token share; a low cached share means a prompt breakpoint
moved and every call is being charged at full rate.

**Day 14.** Look at four numbers: acceptance rate, reply rate, meetings booked,
and how many drafts you sent unedited. The fourth is the one that decides
whether autopilot is worth discussing, and it is worth nothing without the eval
number from step 9 beside it.

### What stops everything

Any of these pauses sending, without anyone watching a dashboard:

- LinkedIn pushes back → the account goes to `restricted` or `warning`, a banner
  appears on every page, and an email goes out immediately.
- Acceptance rate falls below 30% → the nightly sweep flags the account. Low
  acceptance is the signal LinkedIn itself watches.
- A prospect says any of eight opt-out phrases → that sequence ends
  deterministically, before the model sees the message.
- An account is added to the shared exclusion list → checked immediately before
  every send, not only when the campaign was built. A campaign launched this
  morning already has invitations queued against every name on it.

---

## Known gaps at launch

- **The eval has not been run.** Step 9. Until it has, autopilot should not be
  offered to anyone.
- **Acceptance polling is nightly**, so follow-up timing has up to a day of
  slack.
- **Stripe is not configured**, so trials work and nobody can subscribe. Fine
  for a first campaign, not for a second customer.
- **Auth is shared** with the other product in this Supabase project. Two
  existing users can sign in.
- **The pricing table** may be stale for the OpenAI models. Check it before
  quoting a margin.
