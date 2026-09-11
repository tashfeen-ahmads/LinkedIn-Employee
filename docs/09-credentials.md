# The collection worksheet

Everything to gather before Render, where each value comes from, and what it
has to look like. Work down the table; `node scripts/preflight.mjs` checks the
result.

**Three values cannot exist yet.** Unipile's two webhook URLs and the worker's
OAuth redirect URI all contain the worker's public address, and that address is
created by the Render deploy. They are in "After Render" at the bottom — not
forgotten, just genuinely out of order.

Nothing here should be pasted into a chat, a commit, or an issue. Secrets go
straight into the dashboard that needs them.

---

## 1. Supabase — already provisioned

Project `presence-prod`, schema `le`. Dashboard → Settings → API.

**This project rejects the legacy `anon` / `service_role` JWTs.** They are
listed in the dashboard and reported as enabled by the management API, but the
gateway answers `401 Invalid API key` to both. Verified 2026-09-11 by request,
not by reading the setting — which is the only way this is knowable, because
nothing in the dashboard says so.

Use the new key format throughout.

| Value | Where | Goes to | Shape |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → Data API | Render + Netlify (set) | `https://eurlrgolgntdngyaexqr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API Keys → **publishable** | Netlify (set) | `sb_publishable_…` — safe in a browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API Keys → **secret** (create one) | Render only | `sb_secret_…` — bypasses RLS entirely |

The env var names keep saying "anon" and "service_role" because that is what
they mean to the SDK; only the key format changed.

The secret key never goes in Netlify. The web app runs as the signed-in user so
RLS applies; the worker is the only thing that bypasses it, and it does so on
the server.

**Exposed schemas** lives on Settings → **Data API**, not Settings → API Keys.
For this project `le` is already exposed and verified working — a request with
`Accept-Profile: le` returns 200.

## 2. OpenAI

`platform.openai.com` → API keys → Create secret key.

| Value | Goes to | Shape |
| --- | --- | --- |
| `OPENAI_API_KEY` | Render | `sk-proj-…` or `sk-…` |
| `LLM_PROVIDER` | Render, already `openai` in render.yaml | — |

Scope the key to a project with a spend limit. Two models get called: `gpt-5`
for anything a prospect reads, `gpt-5-mini` for classification and fit scoring.

Before the first campaign, spend a few dollars on the eval:
`OPENAI_API_KEY=sk-… pnpm --filter @le/agents eval:classify`. It has never been
run, and it is the number that says whether the human-handoff gate works.

## 3. Unipile

Dashboard → Access Tokens / API Keys.

| Value | Where | Goes to | Shape |
| --- | --- | --- | --- |
| `UNIPILE_DSN` | Dashboard, your dedicated subdomain | Render | `https://apiX.unipile.com:13xxx` — full origin, no trailing slash, **includes the port** |
| `UNIPILE_ACCESS_TOKEN` | Access Tokens | Render | opaque string |
| `UNIPILE_WEBHOOK_SECRET` | **you invent it** | Render + Unipile's webhook config | `openssl rand -hex 32` |

The DSN is per-account and is not `api.unipile.com`. Getting it wrong produces
connection errors rather than auth errors, which sends people looking in the
wrong place.

The webhook secret is not issued by Unipile — you generate it and set the same
string in both places. A missing secret makes the worker reject every delivery,
deliberately: a forged account webhook would bind a stranger's LinkedIn account
to a rep's row and send every campaign message from it.

## 4. Resend

`resend.com` → Domains → add your sending domain → add the DKIM and SPF records
it prints → wait for Verified. Then API Keys → Create.

| Value | Goes to | Shape |
| --- | --- | --- |
| `RESEND_API_KEY` | Render | `re_…` |
| `EMAIL_FROM` | Render | `LinkedIn Employee <hello@yourdomain.com>` |
| `EMAIL_REPLY_TO` | Render, optional | a mailbox a human reads |
| `EMAIL_PROVIDER` | Render, already `resend` in render.yaml | — |

Do the DNS first: it is the only item here with a waiting period, and an
unverified domain is what puts the welcome email in spam. The address in
`EMAIL_FROM` must be on the verified domain — Resend rejects the send otherwise,
and `trySend` swallows it, so the symptom is silence rather than an error.

## 5. Sentry

`sentry.io` → Projects → create a **Node.js** project → Settings → Client Keys
(DSN).

| Value | Goes to | Shape |
| --- | --- | --- |
| `SENTRY_DSN` | Render | `https://<key>@o<org>.ingest.sentry.io/<project>` |
| `SENTRY_ENVIRONMENT` | Render, already `production` | — |

Worker only. `@sentry/nextjs` pulls `@opentelemetry/api`, which splits
`@supabase/supabase-js` into two peer contexts and breaks every query's types in
the web app — documented in `apps/worker/src/observability.ts`. The web app is
where an error is visible immediately anyway; the worker is the process nobody
is watching.

## 6. Google — two clients' worth of work, one client is enough

This is the one place where getting it half right leaves something that looks
like it works. **Google is used twice, for different things, with different
redirect URIs:**

| Use | Redirect URI | Client id/secret goes to |
| --- | --- | --- |
| **Sign in with Google** | `https://eurlrgolgntdngyaexqr.supabase.co/auth/v1/callback` | Supabase dashboard → Authentication → Providers → Google |
| **Calendar** (booking meetings) | `<WORKER_URL>/auth/google/callback` | Render, as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |

One OAuth client with **both** redirect URIs listed is simplest — the scopes are
requested per call, not per client. Two clients also works if you prefer them
separate.

`console.cloud.google.com` → APIs & Services:

1. **Enable the Google Calendar API.** Sign-in works without it; booking fails
   at the first meeting with a permission error.
2. **OAuth consent screen** → External. Scopes: `openid`, `email`, `profile` for
   sign-in, plus `calendar.freebusy` and `calendar.events` for booking.
3. **Credentials** → Create OAuth client ID → Web application → add both
   redirect URIs above (the worker one after Render exists).

`calendar.events` is a **sensitive scope**, so a published app needs Google's
verification, which takes weeks. Leave the consent screen in **Testing** and add
your rep as a test user: up to 100 users, no verification, and the only cost is
an "unverified app" interstitial they click through once. Start verification
before you have real customers, not before your own first campaign.

## 7. Generated by you

```bash
openssl rand -hex 32   # CREDENTIALS_KEY — exactly 64 hex characters
openssl rand -hex 32   # UNIPILE_WEBHOOK_SECRET
```

`CREDENTIALS_KEY` encrypts OAuth refresh tokens before they are stored
(`apps/worker/src/crypto.ts`). **Changing it later makes every stored
integration undecryptable** — every rep reconnects their calendar and CRM. Put
it somewhere you will still have in a year.

`INTERNAL_API_SECRET` is generated by Render itself. Copy it out afterwards: the
web app needs the identical value, and a mismatch makes the worker answer 503 to
every job the web app dispatches.

## 8. Stripe — skip for now

Trials work without it and nobody can subscribe. Fine for one rep and a first
campaign; needed before a second customer.

---

## The gathering checklist

- [x] `le` schema exposed — verified by request, 200
- [x] Netlify carries the publishable key (the legacy anon JWT was rejected)
- [ ] Supabase **secret key** created (`sb_secret_…`) and stored privately
- [ ] Supabase Auth: Site URL and redirect URLs set to the Netlify domain
- [ ] OpenAI key created, spend limit set
- [ ] Unipile DSN (with port) and access token copied
- [ ] Resend domain **verified** (DNS propagated), API key created, from-address on that domain
- [ ] Sentry Node project created, DSN copied
- [ ] Google Calendar API enabled
- [ ] Google consent screen in Testing, rep added as a test user
- [ ] Google OAuth client created with the Supabase redirect URI
- [ ] Google client id/secret pasted into Supabase → Auth → Providers → Google
- [ ] `CREDENTIALS_KEY` generated and stored somewhere durable
- [ ] `UNIPILE_WEBHOOK_SECRET` generated

Everything ticked → deploy Render (`docs/08-go-live.md` step 5).

---

## After Render exists

The worker's public URL is `WORKER_URL`, wired automatically inside Render from
its own external URL. Copy it out for these four:

- [ ] Unipile webhook → `<WORKER_URL>/webhooks/unipile/messages`, with the shared secret
- [ ] Unipile account webhook → `<WORKER_URL>/webhooks/unipile/accounts`, same secret
- [ ] Google OAuth client → add `<WORKER_URL>/auth/google/callback` as a second redirect URI
- [ ] Netlify → `WORKER_URL` and `INTERNAL_API_SECRET`, then redeploy

Then `node scripts/preflight.mjs` with the production environment loaded. It
names every missing variable, probes the worker's `/health`, and asks the
database for one row from `le.workspaces` — which tells "migrations not applied"
apart from "wrong key" apart from "schema not exposed".
