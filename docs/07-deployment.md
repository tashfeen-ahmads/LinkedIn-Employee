# 07 · Deployment and provisioning

Everything here is configuration, not code. Done in order it takes about an
hour; done out of order the OAuth callbacks fail in ways that are tedious to
diagnose, because each provider needs a URL that only exists once the worker is
deployed.

## Order matters

The worker's public URL is the redirect target for four OAuth apps, so it has
to exist before those apps are registered. Deploy the worker with placeholder
credentials first, then register the apps against its real URL.

```
1. Supabase          →  gives you the database URL and keys
2. Redis             →  gives you REDIS_URL
3. Worker            →  gives you WORKER_URL, needed by everything below
4. OAuth apps        →  Google, Microsoft, HubSpot, Salesforce
5. Unipile           →  needs WORKER_URL for its webhook
6. Stripe            →  needs WORKER_URL for its webhook
7. Resend            →  domain verification takes longest; start it early
8. Web app           →  needs all of the above
```

## 1. Supabase

Create a project, then apply the schema in order:

```bash
supabase link --project-ref <ref>
supabase db push          # applies packages/db/supabase/migrations/*.sql
pnpm db:types             # regenerates the TypeScript types from the live schema
```

Four migrations run: the initial schema with row-level security on all 18
tables, billing columns, invitations, and the RLS fixes. **Do not skip the
fourth** — without it nobody can create a workspace or accept an invitation,
because a new user has no membership for the policies to check them against.

From Settings → API, take `NEXT_PUBLIC_SUPABASE_URL`, the anon key, and the
service-role key. The service-role key bypasses row-level security entirely and
belongs only in the worker's environment, never in the web app's client bundle.

## 2. Redis

Any managed Redis works; BullMQ needs nothing special. Upstash's free tier is
enough to start. Set `REDIS_URL`.

## 3. Worker

```bash
fly launch --config apps/worker/fly.toml --no-deploy
fly secrets set \
  NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  ANTHROPIC_API_KEY=... REDIS_URL=... \
  CREDENTIALS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  INTERNAL_API_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly deploy --config apps/worker/fly.toml
```

Two generated secrets matter:

- **`CREDENTIALS_KEY`** encrypts every OAuth token before it reaches Postgres.
  Losing it means every customer reconnects every integration. Back it up
  somewhere that is not this database.
- **`INTERNAL_API_SECRET`** is shared with the web app and authenticates job
  dispatch. Without it the worker returns 503 rather than accepting unsigned
  work, which is deliberate.

Always on. The LinkedIn action queue runs at concurrency 1 to keep one
account's actions properly paced, but the per-account counters are incremented
by `record_linkedin_action` in one statement, so a second instance does not
double-send or lose a count. Sends are paced per account either way; more
machines buy throughput across accounts, not within one.

Confirm it is up: `curl https://<worker>/health` returns `{"ok":true}`.

## 4. OAuth applications

Each callback is `$WORKER_URL/auth/<provider>/callback`.

| Provider | Where | Scopes |
|---|---|---|
| Google | Cloud Console → OAuth client (Web) | `calendar.freebusy`, `calendar.events` |
| Microsoft | Entra ID → App registration | `offline_access`, `Calendars.ReadWrite` |
| HubSpot | Developer account → App | `crm.objects.contacts.read`, `.write` |
| Salesforce | Setup → Connected App | `api`, `refresh_token`, `offline_access` |

Google needs the consent screen published, or refresh tokens stop arriving
after seven days and every calendar silently disconnects. Salesforce sandboxes
need `SALESFORCE_LOGIN_URL=https://test.salesforce.com`.

## 5. Unipile

Create an account, take the DSN and an access token, and point its
new-messages webhook at `$WORKER_URL/webhooks/unipile/messages` with a signing
secret.

The hosted-auth notification goes to `$WORKER_URL/webhooks/unipile/accounts`.
The worker passes that URL with every connect link, so there is nothing to
configure, but the URL has to be reachable from Unipile: this delivery is what
binds a rep's LinkedIn account to their row, and until it arrives their account
has no provider id and every job skips it. A rep who completes the hosted login
and then finds that nothing ever sends is almost always this.

**Set `UNIPILE_WEBHOOK_SECRET`.** The worker rejects unsigned deliveries rather
than trusting them, so an unset secret means inbound replies are refused and no
account can finish connecting — which is the right failure, but it looks like
the integration is broken.

## 6. Stripe

Create three prices with lookup keys exactly `solo`, `pro` and `teams`; the
webhook maps them onto plans by that key. Point the webhook at
`$WORKER_URL/webhooks/stripe` and subscribe to `checkout.session.completed` and
`customer.subscription.*`.

## 7. Resend

Verify the sending domain — this takes longest because DNS propagates on its
own schedule, so start it before you need it. Set `EMAIL_FROM` to a real
address at that domain. Until it verifies, leave `EMAIL_PROVIDER=off`: the
product works, invitations simply show a link to copy instead of arriving by
email.

## 8. Web app

Deploy to Netlify from `apps/web/netlify.toml`. It needs the Supabase URL and
anon key, `APP_URL`, `WORKER_URL`, and the same `INTERNAL_API_SECRET` the
worker has. In Supabase → Authentication → URL Configuration, add
`$APP_URL/auth/callback` as a redirect URL or magic links will not return.

## Verifying it end to end

Run this before the first real prospect:

1. `curl $WORKER_URL/health` → `{"ok":true}`
2. Sign up, and confirm the Strategy Agent produces profiles from your own site.
3. `ANTHROPIC_API_KEY=... pnpm --filter @le/agents eval:classify` → must pass at
   95% needs-human recall. **Do not skip this.** It is the only measurement of
   whether the reply gate makes the right call, as opposed to being wired
   correctly.
4. Connect a LinkedIn account and launch a campaign against a list of five
   people you know. Watch the pacing: invitations should arrive minutes apart
   inside working hours, not in a burst.
5. Reply to one from the other account with a pricing question, and confirm it
   lands in the approval inbox rather than being answered.

## Seeing it without any of this

```bash
supabase start
supabase db push
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from supabase status> \
  pnpm --filter @le/db seed
LINKEDIN_PROVIDER=mock CALENDAR_PROVIDER=mock CRM_PROVIDER=mock EMAIL_PROVIDER=mock \
  pnpm --filter @le/worker dev
pnpm --filter @le/web dev
```

Sign in as `demo@northwind.test`; the magic link appears in the local mail
catcher at `http://127.0.0.1:54324`. The seed puts a workspace a week into a
campaign on every screen, including one reply held back over a pricing question
— which is the thing worth showing anyone.

## Rollback

The web app rolls back through Netlify's deploy history. The worker rolls back
with `fly releases` and `fly deploy --image <previous>`. Migrations are
forward-only: none of them drop a column, so an older build runs against a
newer schema, but write a compensating migration rather than editing one that
has already been applied.
