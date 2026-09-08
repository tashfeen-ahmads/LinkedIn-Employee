# 03 · Technical architecture

## 1. Stack (chosen to reuse what the team already runs)

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | Fast to build, hosts on Netlify which is already connected. |
| Data, auth, storage | Supabase (Postgres, Auth, Row Level Security, Storage, pg_cron) | Already connected to the team's tooling; RLS gives per-workspace isolation for free. |
| Background jobs | A Node worker service (Fly.io or Railway) with BullMQ on Redis | LinkedIn actions must be paced over hours; the web tier cannot hold those jobs. |
| LLM | Anthropic Claude API via `@anthropic-ai/sdk`. `claude-opus-5` for Strategy, Targeting copy, and reply drafting; `claude-haiku-4-5` for reply classification and bulk fit scoring | Opus quality where the customer reads the output; Haiku where volume matters. |
| LinkedIn connectivity | Unipile's LinkedIn API in Phase 1 (hosted auth, messaging, invitations, Sales Navigator search, inbound-message webhooks) with an internal interface so a self-run Playwright worker can replace it in Phase 3 | Weeks instead of months to first customer, and the vendor absorbs the detection engineering. |
| Prospect data (non-Navigator path) | Vibe Prospecting or Apollo for company + person data; enrichment for email in the later email step | Lets Solo users start without Sales Navigator. |
| Calendar | Google Calendar and Microsoft 365 OAuth; Cal.com embed as the booking-link fallback | Reply Agent needs live availability. |
| CRM | HubSpot and Salesforce OAuth apps; Zapier integration; outbound webhooks | Parity with CoPilot AI. |
| Billing | Stripe Billing with per-seat subscriptions and a 7-day trial | Standard. |
| Observability | Sentry, PostHog product analytics, Langfuse (or Anthropic usage logs) for every LLM call | Prompt versions must be reviewable per sent message. |

## 2. Service map

```
Browser ──> Next.js (Netlify) ──> Supabase (Postgres/Auth/Storage)
                 │                        ▲
                 │ enqueue                │ read/write
                 ▼                        │
          Redis / BullMQ  ──>  Worker service (Node)
                                   │  ├─ agents/strategy     (Claude)
                                   │  ├─ agents/targeting    (Claude + data providers)
                                   │  ├─ agents/reply        (Claude + calendar)
                                   │  └─ linkedin/executor   (rate limiter + provider adapter)
                                   ▼
                    Unipile ⇄ LinkedIn        Google/MS Calendar      HubSpot / Salesforce
                    (Phase 3: own Playwright pool + residential proxies)
```

## 3. The LinkedIn execution layer (the risky part, isolated on purpose)

`LinkedInProvider` interface, one implementation per backend:

```ts
interface LinkedInProvider {
  connectAccount(userId): Promise<HostedAuthUrl>;          // rep logs in, we never store the password
  searchSalesNavigator(query, page): Promise<ProspectPage>;
  getProfile(providerId): Promise<Profile>;
  sendInvitation(providerId, note?): Promise<ActionResult>;
  withdrawInvitation(invitationId): Promise<void>;
  sendMessage(chatId | providerId, text): Promise<ActionResult>;
  listNewMessages(since): AsyncIterable<InboundMessage>; // webhook-fed in Unipile
  accountHealth(): Promise<'ok' | 'warning' | 'restricted' | 'reauth_required'>;
}
```

Every action goes through a **per-account token bucket** in Redis: daily and weekly caps,
minimum gap between actions (2 to 9 minutes, jittered), working-hours window, and a global kill
switch. The scheduler never sends more than the cap even when the queue is full. Health is
polled hourly and any non-ok status pauses the account and notifies the rep.

Phase 3 replaces Unipile with our own Playwright workers only if margin or reliability demands it.
The interface means the agents never know which backend is live.

## 4. Data model (core tables, all with `workspace_id` and RLS)

- `workspaces`, `memberships` (role), `users`
- `linkedin_accounts` (user, provider account id, status, daily counters)
- `business_profiles`, `customer_profiles` (JSONB spec + Sales Navigator filter map)
- `prospects` (workspace-unique on LinkedIn URL; fit score, intent signals JSONB, owner, do-not-contact)
- `campaigns`, `campaign_steps`, `campaign_prospects` (state machine: queued -> invited -> accepted -> messaged_n -> replied -> positive/negative/closed -> meeting_booked)
- `conversations`, `messages` (direction, source human|agent, prompt_version, classification)
- `meetings` (calendar event id, prospect, rep, CRM record id)
- `integrations` (encrypted OAuth tokens), `webhook_endpoints`, `events` (append-only audit log)
- `llm_calls` (model, tokens, cost, latency, prompt_version, linked entity)

## 5. Agent implementation notes

- All three agents are **workflows, not open-ended agents**: fixed steps, Claude called with
  structured outputs (`output_config.format`) and `strict: true` tools, so every artifact validates
  against a schema before it touches the database.
- Use adaptive thinking on Opus for Strategy and reply drafting; effort `medium` for drafts,
  `high` for the Business Profile.
- Prompt caching: Business Profile + Customer Profile + rep bio form a stable system prefix per
  campaign, so reply drafting mostly pays for the new message only.
- Reply classification returns `{intent, sentiment, needs_human, reason}`; the gate in
  `agents/reply` applies the campaign rules before any send.
- Evals from week one: a 200-message labelled set for classification (target > 95% on
  needs_human recall, since a miss there is the costly error) and a rubric-graded set for drafts.

## 6. Security

- LinkedIn credentials never touch our servers (hosted auth). OAuth tokens encrypted at rest
  with a KMS key, not in plain Postgres columns.
- RLS on every table; the worker uses a service role scoped per job.
- Per-workspace data export and delete endpoints for GDPR requests.
- Secrets in the host's secret manager; no `.env` files in the repo.

## 7. Repository layout (monorepo)

```
apps/web         Next.js app
apps/worker      BullMQ worker, agents, LinkedIn executor
packages/db      Supabase migrations, generated types, RLS policies
packages/agents  Prompts, schemas, evals (versioned)
packages/shared  Types, zod schemas, event names
docs/            These documents
```
