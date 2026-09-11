# LinkedIn Employee — working notes

An AI SDR for LinkedIn. Read `README.md` for what it is and `docs/` for the
plan. This file is for whoever works on the code next.

## Commands

```bash
pnpm install
pnpm build          # packages compile to dist/; apps typecheck against those
pnpm typecheck
pnpm test           # 427 tests, no network, no API key needed
node scripts/mutation-check.mjs   # proves the safety tests actually bite
node scripts/preflight.mjs        # is a deployment actually able to send?
pnpm --filter @le/web dev
pnpm --filter @le/worker dev
```

Build before typechecking: the apps resolve `@le/*` through each package's
`dist/`, so a stale build produces confusing type errors in files you did not
touch. If a query result infers as `never`, rebuild `@le/db` first.

The agents run on whichever model provider has a key: `OPENAI_API_KEY` selects
GPT-5-mini for both roles, `ANTHROPIC_API_KEY` selects Opus and Haiku, and the seam
between them is `createLlmClient` in `packages/agents/src/llm.ts`. Nothing above
that file knows which one answered. A deployment with neither key is refused at
boot, not at the first agent call.

Tables live in the `le` schema, not `public` — this deployment shares a Supabase
project with an unrelated product. `DB_SCHEMA` in `packages/db/src/client.ts` is
the one definition; `scripts/schema-install.mjs` generates the install for it.
Going live is `docs/08-go-live.md`; the values to collect first are
`docs/09-credentials.md`.

Set `LINKEDIN_PROVIDER=mock`, `CALENDAR_PROVIDER=mock` and `CRM_PROVIDER=mock`
to run the whole flow without touching anyone's real account, then
`pnpm --filter @le/db seed` to put a worked example on every screen. Deployment
and provisioning are in `docs/07-deployment.md`.

## The rules that are not negotiable

These are the places where a bug reaches a real person, and each is guarded by
tests that were verified by deliberately breaking the code.

1. **Every LinkedIn action goes through `apps/worker/src/jobs/linkedin-action.ts`.**
   It re-checks the rate limiter immediately before sending, because minutes
   pass between scheduling and sending. Do not add a second path to the
   provider.
2. **The counters the limiter reads are incremented in one SQL statement**
   (`record_linkedin_action`, called by `recordAction`). Reading a counter and
   writing back read + 1 loses one of two concurrent sends, which is an account
   quietly passing its cap. A failed write raises rather than being swallowed.
3. **The caps in `packages/shared/src/constants.ts` are product rules, not
   tunables.** They come from the vendor consensus recorded in
   `docs/06-research.md` section 2. Per-account overrides may only go lower.
   Unipile applies no limits of its own, so this file is the only thing between
   a campaign and a restricted account.
4. **The reply gate (`applyRules` in `packages/agents/src/reply.ts`) is pure and
   stays pure.** Autopilot changes what happens to a clean message, never what
   counts as clean.
5. **The model never invents a datetime.** `packages/calendar/src/slots.ts`
   produces the only times that reach a prospect; the model picks from that
   list. Booking matches an acceptance against the slots we actually offered.
6. **Opt-outs are checked deterministically as well as by the model**
   (`containsOptOut`). Sending after "remove me" is the one mistake this
   product cannot make.
7. **Webhooks and the internal API fail closed.** A missing secret rejects
   rather than accepts; see `apps/worker/src/server.ts`. That includes
   `/webhooks/unipile/accounts`, where a forged delivery would bind a
   stranger's LinkedIn account to a rep's row and send every campaign message
   from it.
8. **Targeting refuses a customer profile nobody has approved**
   (`approved_at` in `apps/worker/src/jobs/targeting.ts`). The Strategy Agent
   writes profiles; it does not approve them. Approval happens on
   `/app/strategy` and nowhere else.
9. **Nothing held for a human is invisible.** `/app/inbox` lists conversations,
   not drafts: a conversation can be flagged with no draft at all, and while the
   page listed drafts those were shown to nobody. Holds carry a kind
   (`apps/worker/src/holds.ts`) so sending a reply clears the reply hold and
   never the one asking someone to book a meeting by hand.
10. **The knowledge base is never truncated to fit the prompt**
    (`selectKnowledge` in `packages/agents/src/knowledge.ts`). A document too
    long is left out whole and named to the model as unread. Half a pricing
    page is answered from confidently, and the wrong price reaches the prospect
    looking like the right one.
11. **Prospect search runs on the tier the account actually has**
    (`has_sales_navigator` → `tier` in `apps/worker/src/jobs/targeting.ts`).
    Sales Navigator is a separate ~$120/month seat, and a search sent to a tier
    an account does not have returns nothing at all — which reads on screen as
    "your customer profile matched nobody" rather than "you are not
    subscribed". Classic search cannot express seniority, company size or
    excluded titles, so those are named in `droppedFilters` and shown on the
    campaign before anyone launches it. A filter that silently becomes a
    suggestion is worse than one that is missing: the list still looks like
    what was asked for.
12. **The shared exclusion list is checked immediately before every send**, not
    only when a campaign is built (`matchExclusion` in
    `packages/shared/src/exclusions.ts`). A campaign launched this morning
    already has invitations queued against every name on it; an account added
    at 10am has to stop the 10:05 send. Matching is deterministic for the same
    reason opt-outs are — "never contact this account" is a promise a colleague
    made to a customer.

## Conventions

- Agent output is validated against a zod schema before it touches the
  database. Model-facing schemas use `.nullable()` rather than `.optional()`:
  structured outputs reject optional keys.
- Every sent message records the `prompt_version` that produced it, so a
  regression traces back to the change that caused it. Bump the version
  constant when you edit a prompt.
- Prompt-cache the stable context (business profile, customer profile, rep bio)
  and leave the varying part after the breakpoint. `/app/usage` shows whether
  it is working; a low cached share there means a breakpoint moved.
- Model prices live in `packages/shared/src/pricing.ts` and are the one thing
  here that changes without anyone touching the repo. A model missing from that
  table costs `null`, never zero.
- Tenant tables all carry `workspace_id` and RLS. The worker uses the service
  role, so it must filter by `workspace_id` itself — RLS will not save you
  there.
- OAuth tokens are encrypted before insert (`apps/worker/src/crypto.ts`). Never
  store a raw token.

## Testing

`apps/worker/test/fake-db.ts` is an in-memory stand-in for the Supabase client
covering the query shapes the worker uses. It is not a Postgres emulator; where
it cannot be faithful it throws rather than returning something a real database
never would. Embedded joins (`select("user_id, profiles(email)")`) are the case
worth knowing: PostgREST returns the related row, the fake cannot, and for a
while it returned the parent row without it — so the caller silently took its
"no such record" branch and the tests were green and wrong. It now throws. Select
the foreign key and fetch the related rows separately, as `digest.ts` does.

When you add a test for a safety rule, add a mutation to
`scripts/mutation-check.mjs` too. It breaks each rule on purpose and requires
that some test notice; CI runs it on every push.

This is not ceremony. Twice a test here passed for the wrong reason — once by
setting `needsHuman: true`, which routes to hold-for-human and never reaches
the branch it claimed to cover, and once by using a phrase the acceptance
matcher rejects outright. Both were green. Neither would have caught a
regression. A test that passes for the wrong reason is worse than no test,
because it stops anyone looking again.

A `SURVIVED` line names an unguarded rule. A `STALE` line means the code moved
and the mutation no longer matches — fix the mutation, or it silently stops
checking anything.

The classification eval (`packages/agents/evals/`) costs money and needs an API
key, so it is not in CI and **has not been run yet**. Run it before the first
live campaign and record the number in its README.

## Known gaps

- Acceptance is detected by polling connections nightly
  (`apps/worker/src/jobs/acceptance.ts`), so a follow-up can be up to a day
  later than its configured delay. Unipile exposes no acceptance webhook; if
  one appears, that is where to use it.

- The email follow-up channel for prospects who accept an invitation then go
  quiet. Roadmap item for quarter two; the email layer it would need already
  exists in `packages/email`.
- The Solo plan's no-Sales-Navigator path in `docs/02-product-spec.md` should
  not be built as written. LinkedIn sued Proxycurl and it shut down in July
  2025; see `docs/06-research.md`.
