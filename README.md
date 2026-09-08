# LinkedIn Employee

An AI SDR for LinkedIn. It builds your customer profiles, finds high-fit and high-intent
prospects, starts conversations, and books meetings into your calendar. You show up and close.

Modelled on the four-agent workflow popularised by CoPilot AI (Strategy, Targeting, Reply, Close),
built to be safer for the rep's LinkedIn account and more transparent about why each lead was chosen.

## Repository layout

```
apps/web           Next.js 15: marketing site, auth, onboarding, dashboard, approval inbox, billing
apps/worker        BullMQ worker: agent jobs, campaign pacing, LinkedIn executor, webhooks, OAuth
packages/agents    The three agents on Claude, with prompts, schemas and evals versioned together
packages/linkedin  Provider interface, Unipile adapter, mock, and the rate limiter
packages/calendar  Calendar interface, Google adapter, and the deterministic slot finder
packages/crm       CRM interface, HubSpot adapter, and signed outbound webhooks
packages/billing   Entitlement rules and the Stripe client
packages/shared    Zod schemas, campaign state machine, safety caps
packages/db        Supabase migrations, row-level security, types
docs/              Plan and research
```

## How it fits together

1. **Strategy Agent** reads the company's own pages and writes a Business Profile plus three to
   five Customer Profiles, each carrying the Sales Navigator filters to execute it.
2. **Targeting Agent** searches, dedupes against every prospect the workspace has already touched,
   scores fit with Claude and intent deterministically, and drafts a campaign.
3. **Campaign tick** paces the sending. It asks the rate limiter what today's remaining budget is
   and enqueues at most that much work, with randomized gaps inside the rep's working hours.
4. **Reply Agent** classifies each inbound message, applies the campaign's rules of engagement, and
   either sends the reply or parks it in the approval inbox.

Every action that touches a real LinkedIn account goes through one code path
(`apps/worker/src/jobs/linkedin-action.ts`), which re-checks the limiter immediately before
sending, honours provider health signals, and writes an audit record.

## What is built

| Area | State |
|---|---|
| Strategy, Targeting and Reply agents | Built, on Claude with structured outputs |
| Campaign pacing and the LinkedIn rate limiter | Built and unit-tested against the researched caps |
| Approval inbox and the send/hold gate | Built, gate is a pure tested function |
| Calendar availability and meeting booking | Built (Google); Microsoft 365 not yet |
| CRM sync | HubSpot and signed webhooks; Salesforce not yet |
| Billing and trial enforcement | Built (Stripe) |
| Internal API auth, encrypted OAuth tokens, RLS | Built |
| Reply-classification eval | Harness and dataset built, **not yet run** — needs an API key |
| Non-Sales-Navigator prospect data | **Not built.** See the note below |
| Email follow-up channel | Not built |

### The one plan item that needs rethinking

`docs/02-product-spec.md` proposes a Solo plan that works without a Sales
Navigator seat by using third-party prospect data. The research
(`docs/06-research.md` section 2) found that LinkedIn sued Proxycurl, the
obvious provider, and it shut down permanently in July 2025 under a permanent
injunction. Do not build that path on a scraping-based data vendor without
fresh legal advice.

## Safety model

The caps in `packages/shared/src/constants.ts` are product rules, not tunables: 10 connection
requests a day ramping to 35 over five weeks, never more than 100 a week, 50 messages a day,
two-to-nine-minute jittered gaps, working hours only. Any warning from the provider pauses the
account. Opt-out phrases stop a sequence immediately, whatever the model concluded. See
`docs/06-research.md` section 2 for the sources these numbers come from.

## Running it

```bash
pnpm install
cp .env.example .env            # fill in Supabase, Anthropic, Unipile, Redis
pnpm build && pnpm test

pnpm --filter @le/web dev       # http://localhost:3000
pnpm --filter @le/worker dev    # http://localhost:4000
```

Set `LINKEDIN_PROVIDER=mock` to develop the full flow without touching LinkedIn.

Apply the database schema with the Supabase CLI:

```bash
supabase db push                # or: psql "$DATABASE_URL" -f packages/db/supabase/migrations/0001_init.sql
pnpm db:types                   # regenerate packages/db/src/database.types.ts
```

## Plan

| Doc | Contents |
|---|---|
| [01 · CoPilot AI teardown](docs/01-copilot-ai-teardown.md) | What they do, how they reach LinkedIn, where we beat them |
| [02 · Product spec](docs/02-product-spec.md) | The four agents, team and CRM features, safety rules, pricing, metrics |
| [03 · Architecture](docs/03-architecture.md) | Stack, LinkedIn execution layer, data model, agent implementation, security |
| [04 · Roadmap](docs/04-roadmap.md) | 12-week plan, design-partner programme, risks |
| [05 · Go-to-market](docs/05-go-to-market.md) | Positioning, landing page, launch campaign, onboarding funnel |
| [06 · Research](docs/06-research.md) | Sourced findings on Unipile, LinkedIn limits, competitors, intent data |
