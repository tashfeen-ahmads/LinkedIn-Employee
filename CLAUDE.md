# LinkedIn Employee — working notes

An AI SDR for LinkedIn. Read `README.md` for what it is and `docs/` for the
plan. This file is for whoever works on the code next.

## Commands

```bash
pnpm install
pnpm build          # packages compile to dist/; apps typecheck against those
pnpm typecheck
pnpm test           # 163 tests, no network, no API key needed
pnpm --filter @le/web dev
pnpm --filter @le/worker dev
```

Build before typechecking: the apps resolve `@le/*` through each package's
`dist/`, so a stale build produces confusing type errors in files you did not
touch. If a query result infers as `never`, rebuild `@le/db` first.

Set `LINKEDIN_PROVIDER=mock`, `CALENDAR_PROVIDER=mock` and `CRM_PROVIDER=mock`
to run the whole flow without touching anyone's real account.

## The rules that are not negotiable

These are the places where a bug reaches a real person, and each is guarded by
tests that were verified by deliberately breaking the code.

1. **Every LinkedIn action goes through `apps/worker/src/jobs/linkedin-action.ts`.**
   It re-checks the rate limiter immediately before sending, because minutes
   pass between scheduling and sending. Do not add a second path to the
   provider.
2. **The caps in `packages/shared/src/constants.ts` are product rules, not
   tunables.** They come from the vendor consensus recorded in
   `docs/06-research.md` section 2. Per-account overrides may only go lower.
   Unipile applies no limits of its own, so this file is the only thing between
   a campaign and a restricted account.
3. **The reply gate (`applyRules` in `packages/agents/src/reply.ts`) is pure and
   stays pure.** Autopilot changes what happens to a clean message, never what
   counts as clean.
4. **The model never invents a datetime.** `packages/calendar/src/slots.ts`
   produces the only times that reach a prospect; the model picks from that
   list. Booking matches an acceptance against the slots we actually offered.
5. **Opt-outs are checked deterministically as well as by the model**
   (`containsOptOut`). Sending after "remove me" is the one mistake this
   product cannot make.
6. **Webhooks and the internal API fail closed.** A missing secret rejects
   rather than accepts; see `apps/worker/src/server.ts`.

## Conventions

- Agent output is validated against a zod schema before it touches the
  database. Model-facing schemas use `.nullable()` rather than `.optional()`:
  structured outputs reject optional keys.
- Every sent message records the `prompt_version` that produced it, so a
  regression traces back to the change that caused it. Bump the version
  constant when you edit a prompt.
- Prompt-cache the stable context (business profile, customer profile, rep bio)
  and leave the varying part after the breakpoint.
- Tenant tables all carry `workspace_id` and RLS. The worker uses the service
  role, so it must filter by `workspace_id` itself — RLS will not save you
  there.
- OAuth tokens are encrypted before insert (`apps/worker/src/crypto.ts`). Never
  store a raw token.

## Testing

`apps/worker/test/fake-db.ts` is an in-memory stand-in for the Supabase client
covering the query shapes the worker uses. It is not a Postgres emulator; where
it cannot be faithful it throws rather than returning something a real database
never would.

When you add a test for a safety rule, check it actually bites: break the rule
on purpose and confirm the test fails. Several of these tests initially passed
against broken code.

The classification eval (`packages/agents/evals/`) costs money and needs an API
key, so it is not in CI and **has not been run yet**. Run it before the first
live campaign and record the number in its README.

## Known gaps

- Salesforce, Microsoft 365 calendar, and the email follow-up channel.
- The Solo plan's no-Sales-Navigator path in `docs/02-product-spec.md` should
  not be built as written. LinkedIn sued Proxycurl and it shut down in July
  2025; see `docs/06-research.md`.
