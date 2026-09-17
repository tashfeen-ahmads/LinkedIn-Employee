# LinkedIn Employee — working notes

An AI SDR for LinkedIn. Read `README.md` for what it is and `docs/` for the
plan. This file is for whoever works on the code next.

## Commands

```bash
pnpm install
pnpm build          # packages compile to dist/; apps typecheck against those
pnpm typecheck
pnpm test           # 432 tests, no network, no API key needed
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
3. **The warm-up ramp starts at an account's first action, not at its
   connection** (`first_action_at`, stamped by `record_linkedin_action`; read by
   `dailyInviteCap`). Those are the same day for someone who connects and
   launches together, and weeks apart for someone wiring up a deployment — and
   measuring from connection would hand a never-used account its full allowance
   on the first day it ever sends. An account that has sent nothing sits at the
   starting cap however long ago it was connected.
4. **The caps in `packages/shared/src/constants.ts` are product rules, not
   tunables.** They come from the vendor consensus recorded in
   `docs/06-research.md` section 2. Per-account overrides may only go lower.
   Unipile applies no limits of its own, so this file is the only thing between
   a campaign and a restricted account.
5. **The reply gate (`applyRules` in `packages/agents/src/reply.ts`) is pure and
   stays pure.** Autopilot changes what happens to a clean message, never what
   counts as clean.
6. **The model never invents a datetime.** `packages/calendar/src/slots.ts`
   produces the only times that reach a prospect; the model picks from that
   list. Booking matches an acceptance against the slots we actually offered.
7. **Opt-outs are checked deterministically as well as by the model**
   (`containsOptOut`). Sending after "remove me" is the one mistake this
   product cannot make.
8. **Webhooks and the internal API fail closed.** A missing secret rejects
   rather than accepts; see `apps/worker/src/server.ts`. That includes
   `/webhooks/unipile/accounts`, where a forged delivery would bind a
   stranger's LinkedIn account to a rep's row and send every campaign message
   from it.

   Being *told* an account changed and *asking* whether it did are different
   claims, and the code treats them differently. `bindAccounts`, on the push
   path, may only complete a connection someone here started — it never
   re-points a row that is already working. `reconcileAccount`, on the pull
   path, does re-point one, because it runs on a list the worker fetched
   itself over an authenticated call the rep began. Without it an `active` row
   holding an id the provider has dropped is unfixable except by hand: every
   job fails against it while the Team page shows a healthy account and a
   button that does nothing, which is where the first live deployment sat.
   What both share is the binding rule — an account is only ever matched to
   the rep whose user id it carries as its reference. Do not loosen that.

   Repair must never depend on somebody finding a button. `recoverAccounts`
   runs in nightly maintenance and the Team page asks on arrival whenever the
   rep's account is not active, because the common failure is silent from the
   inside: a rep reconnects, the provider issues a *new* account with a new id,
   our row keeps the old one, and the provider's own dashboard then shows a
   healthy green connection while this product says "reauth required". Two
   screens contradicting each other, with the right answer on the one nobody is
   reading. The health poll made it worse — it asks about the id we hold, gets
   a 404, marks the row dead, and never asks whether a live account is sitting
   beside it — so recovery runs *before* polling. A failure to list provider
   accounts is never read as "the provider has none": one bad minute would
   otherwise disconnect every account on the deployment.
9. **Targeting refuses a customer profile nobody has approved**
   (`approved_at` in `apps/worker/src/jobs/targeting.ts`). The Strategy Agent
   writes profiles; it does not approve them. Approval happens on
   `/app/strategy` and nowhere else.
10. **Nothing held for a human is invisible.** `/app/inbox` lists conversations,
   not drafts: a conversation can be flagged with no draft at all, and while the
   page listed drafts those were shown to nobody. Holds carry a kind
   (`apps/worker/src/holds.ts`) so sending a reply clears the reply hold and
   never the one asking someone to book a meeting by hand.
11. **The knowledge base is never truncated to fit the prompt**
    (`selectKnowledge` in `packages/agents/src/knowledge.ts`). A document too
    long is left out whole and named to the model as unread. Half a pricing
    page is answered from confidently, and the wrong price reaches the prospect
    looking like the right one.
12. **Prospect search runs on the tier the account actually has**
    (`has_sales_navigator` → `tier` in `apps/worker/src/jobs/targeting.ts`).
    Sales Navigator is a separate ~$120/month seat, and a search sent to a tier
    an account does not have returns nothing at all — which reads on screen as
    "your customer profile matched nobody" rather than "you are not
    subscribed". Classic search cannot express seniority, company size or
    excluded titles, so those are named in `droppedFilters` and shown on the
    campaign before anyone launches it. A filter that silently becomes a
    suggestion is worse than one that is missing: the list still looks like
    what was asked for.

    LinkedIn searches places and industries by id and never by name, so every
    word the Strategy Agent writes is looked up in LinkedIn's own taxonomy
    first (`resolveFilters`, `/linkedin/search/parameters`). `location:
    ["United States"]` is not a loose match returning fewer people — it is not
    a location, and the search returns nobody, which is exactly how the first
    live campaign found nothing. Two things happen in that lookup and both are
    reported in `filterNotes`: a term LinkedIn does not have is left out, and a
    term it renamed (its industry taxonomy changed in 2022) narrows the list
    without anyone asking. Several titles or keywords are joined with `OR`, not
    with spaces — space-joined they are an AND that matches nobody.
13. **Nobody enters a campaign whose profile cannot be opened and checked**
    (`verifyProfiles` in `apps/worker/src/jobs/targeting.ts`). LinkedIn hides a
    profile's public address from anyone outside the viewer's network, so a
    real person can arrive from a search with no link to them — they are not
    fake, and the screens must not call them that. But an invitation is spent
    from a capped daily allowance, it carries restriction risk for the account
    sending it, and a reviewer who cannot open the profile cannot do the one
    job the review exists for. So they are dropped, and the count is reported
    rather than quietly shrinking the list.

    Resolving is tried before dropping: the profile endpoint usually knows the
    public identifier the search result omitted, which turns a real person into
    a usable prospect instead of discarding them. That lookup is spent only on
    candidates that arrived without one — never as a second pass over everybody,
    because every request comes off a seat somebody pays for.

    `isPublicProfileUrl` is the one definition, and it takes the provider id on
    purpose: `linkedin.com/in/<provider id>` is shaped exactly like a real
    address and 404s every time. A rule that checked only the shape passed every
    one of them, which is how a list of real people came to look invented twice.

14. **The shared exclusion list is checked immediately before every send**, not
    only when a campaign is built (`matchExclusion` in
    `packages/shared/src/exclusions.ts`). A campaign launched this morning
    already has invitations queued against every name on it; an account added
    at 10am has to stop the 10:05 send. Matching is deterministic for the same
    reason opt-outs are — "never contact this account" is a promise a colleague
    made to a customer.

15. **The operator console can see that a workspace exists, not what it says.**
    Platform admins (`platform_admins`, migration 0010) get additive SELECT
    policies on workspaces, members, accounts, campaigns, events and spend —
    never on `messages`, `conversations`, `reply_drafts` or `prospects`, which
    hold other people's personal data and the contents of private conversations.
    Counts for those come from `platform_workspace_stats()`, whose
    `where is_platform_admin()` is the entire access check and is one line away
    from not being there. Nothing grants admin through the API: the table has no
    insert policy, so it takes the service role or a SQL console.

    Test this with a workspace the admin is *not* a member of. An admin who is
    also a member reads it through the ordinary membership policy, and a test
    set up that way passes without proving anything — which is exactly what
    happened the first time.

16. **A connection request is written for the person who receives it.**
    `personalizeInvites` writes one note per prospect from that prospect's own
    details, stored on `campaign_prospects` and read by a human before launch.
    Before it existed, everyone in a campaign got the campaign's template with
    `{{first_name}}` substituted — the headline, title, company and about text
    were searched for, scored, stored, shown on screen, then dropped at the one
    moment they mattered. `inviteNote` sends the personalised note verbatim and
    falls back to the template when there is none, so a writer outage degrades a
    campaign instead of stopping it. The note is matched to its prospect by
    provider id, never by position: the failure mode of index matching is the
    wrong person receiving a paragraph about somebody else, under a real rep's
    name. `grounding` names the prospect details the note used, which is what
    makes "personalised" checkable rather than a matter of opinion — empty
    grounding is reported on the review screen, not hidden.

17. **The system check never reports a stage as working because it could not
    look.** `apps/worker/src/jobs/diagnostics.ts` walks every precondition from
    onboarding to replies and renders on `/app/system`. Two of its checks call
    the provider rather than reading a row — an account row saying `active` for
    an id Unipile had dropped is what cost a week, and only asking catches it.
    A stage it skips reports `waiting`, never `ok`: a check that passes because
    it did not run sends someone to investigate the wrong stage, which is the
    same disease as everything else on this list. It is read-only and scoped to
    the caller's own workspace and account; it must never report what other
    accounts the provider holds.

18. **The calendar this product owns knows only what we put in it.**
    Google will not grant calendar scopes to an app that has not been through
    brand verification, and that needs a verified domain and a review measured
    in weeks — so requiring it made the last stage of the product impossible to
    demonstrate. `CALENDAR_PROVIDER=own` is the default;
    `OwnCalendarProvider` treats meetings booked here and
    `availability_blackouts` as busy, and there is nothing else it can see. The
    blackout list is therefore the whole defence against double-booking, and
    every screen that touches availability says so rather than implying a
    calendar that watches everything.

    Two things stop a real person sitting in an empty call. `bookFromLink`
    re-derives the free slots and refuses a `startsAt` that is not among them,
    because that value arrives from a form; and
    `meetings_one_per_rep_slot` (migration 0012) is a unique index, because
    checking availability in the application and then inserting is a
    read-then-write race, and the person who loses it finds out by turning up.
    A booking link's token is its entire authorisation: every refusal says the
    same thing whether the token is expired, revoked or invented, or the page
    becomes a way to learn which tokens exist.

19. **A calendar feed URL is typed by a user and fetched by the worker, which
    is server-side request forgery unless it is stopped.** The worker holds the
    service-role key and answers its own internal API on localhost, so a feed
    pointed at `127.0.0.1:4000` or `169.254.169.254` reaches things no browser
    could, with our credentials. `checkFeedUrl` requires https and refuses
    private hosts; `fetchIcs` resolves DNS and vets the address, follows
    redirects by hand and re-checks every hop, because a 302 undoes every check
    made before it. The address itself is a bearer credential for the rep's
    whole calendar: encrypted before insert, never returned to the browser
    (`url_host` is what the UI shows), never logged.

    A feed that fails to refresh **keeps the intervals from its last good
    read** and is marked `failing`. Deleting them would turn a rotated URL or a
    bad afternoon at Google into a calendar that suddenly looks completely
    free, and of the two failures that is the one that double-books somebody.
    `ownOnly` stays true while a feed is failing, so no screen tells a rep
    their diary is being watched when the last read of it broke.

    In `parseIcsBusy` every ambiguity errs towards more busy time, not less: a
    block we invent costs an offered slot, a block we miss costs the meeting.
    `STATUS:CANCELLED` and `TRANSP:TRANSPARENT` are the two exceptions, and
    both are events the rep has said are not busy.

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
