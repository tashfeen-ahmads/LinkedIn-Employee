# LinkedIn Employee — working notes

An AI SDR for LinkedIn. Read `README.md` for what it is and `docs/` for the
plan. This file is for whoever works on the code next.

## Commands

```bash
pnpm install
pnpm build          # packages compile to dist/; apps typecheck against those
pnpm typecheck
pnpm test           # 838 tests, no network, no API key needed
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

20. **A search remembers where it stopped, and a page read is a page spent.**
    A campaign is one list grown a page at a time, not one search: `Find more`
    on `/app/campaigns/[id]` continues the same query from the position stored
    on the campaign (`search_cursor`, migration 0014). Classic search is several
    separate keyword searches, so that position is composite — every term's
    place travels together (`packages/linkedin/src/cursor.ts`), because the
    classic path used to return `cursor: null` and every run therefore began at
    the first page, found the same fifty people, and reported all fifty as
    already known. Everyone past the first page was unreachable by design.

    The position moves on whatever the run found. A page whose fifty people
    were all already on the list is the normal case once a campaign is a few
    hundred deep, and advancing only on a run that produced prospects would
    park the campaign on that page for ever. LinkedIn will not hand those
    profiles back except by handing back the same page, and they came off a
    seat somebody pays for, so nobody is trimmed off the end of a merged page
    either: each term asks only for what the page still has room for.

    `search_exhausted` is the end of LinkedIn's answer and is not the same as a
    run finding nobody new — one means stop offering the button, the other
    means press it again. Running out inside the industry filter is neither:
    dropping that filter is a different search over people the filtered pass
    could never have returned, so it is the next position, not the end.
    Continuing reads the profile and the account off the campaign's own row and
    never off the request, or the endpoint is a way to graft one campaign's
    approved copy onto another profile's search. A campaign being added to
    keeps the copy a human already approved; growing a list must not rewrite
    what everybody already queued is about to receive.

21. **A quiet system has to prove it is running.** The pacing loop
    (`apps/worker/src/jobs/campaign-tick.ts`) declines far more often than it
    acts — outside working hours, allowance spent, nothing due — and every one
    of those exits is a correct, silent `continue`. Which means a campaign
    launched into a dead worker and a campaign waiting out the two-to-eleven
    minute gap between invitations are the same screen: status `running`,
    nobody invited, nothing changed. The first live launch was spent on that
    question, and the answer was only in the deployment's logs, where the
    person who pressed Launch cannot go.

    So the loop stamps `worker_heartbeats` on **every** run, including the ones
    that send nobody (migration 0015). A stamp written only on a productive run
    would be missing during exactly the quiet stretch it exists to explain.
    `/app/system` reports a stale heartbeat as `blocked`, because every other
    green tick on that screen is meaningless if nothing is sending.

    The stamp carries **why**, not only how many. `enqueued: 0` is what the
    loop says at two in the morning and also what it says when the account is
    disconnected, the trial has lapsed, or there is nobody left to invite —
    four different things to do about it, reported identically. It carries the
    queue counts too, because `jobId: invite:<id>` is what stops a second tick
    queueing the same invitation, and BullMQ accepts an add whose id is already
    taken without replacing the job: one failed action keeps its slot for the
    whole `removeOnFail` window, so that person is never re-queued while every
    screen reports a healthy loop. The counts are the only place that shows.

    The campaign page answers "when does the next invitation go out" using
    `checkAction` itself (`describePacing` in `apps/web/src/lib/pacing.ts`),
    never a second reading of the rule written for the screen — two readings
    drift, and the screen's is the one somebody believes. A dead loop is
    reported ahead of every gentler explanation: "waiting for your sending
    hours" is a reassuring sentence about a system that will never send.

    Launching calls the worker (`/jobs/campaign-tick`) rather than setting a
    row and trusting the schedule to notice. The action that most needs the
    worker was the only one that never spoke to it.

    The stamp is written **even when the run throws** — before the rethrow, not
    instead of it. It used to be written last, so a tick that failed wrote
    nothing, and a loop running and failing every five minutes was reported as
    a loop that had stopped. That is not hypothetical: the first tick that had
    real work to do threw, and eight hours of that read as silence.

22. **`/health` is the check the platform believes, so it has to look.** It
    answered `{ ok: true }` unconditionally, and an afternoon went into what
    that hides: the process up, Render reporting the service Live, the HTTP API
    answering every request, and every job queued since the morning unconsumed.
    BullMQ requires `maxRetriesPerRequest: null` — a blocking read that gives
    up mid-wait loses the job it holds — and the price is that a command against
    an unreachable Redis never fails either. It waits, silently, for ever. "The
    queue is gone" and "there is nothing to do" are the same observation from
    every screen in the product.

    So `queueReachable` pings with a **deadline**, and that deadline is the
    whole mechanism: without it the check waits exactly as long as the client
    does, and a health check that hangs tells you nothing.

    The queue's state goes in `/health`'s **body, never its status code**. The
    platform reads this route to decide whether a deployment may go live, so
    answering 503 on an unreachable queue makes the build that would explain
    the problem the one build that can never be promoted — the deployment keeps
    serving older code that says nothing. A restart does not reach a Redis that
    is not there; ioredis reconnects on its own. `/jobs/*` does refuse outright,
    because that is a different question: not "may I run" but "may I promise to
    do this piece of work", and an accepted job that was never queued reaches
    the person as a button that did nothing — which is also what a correctly
    paced campaign looks like. `loadEnv` refuses to boot a production worker
    whose `REDIS_URL` is localhost, which is what an unset variable falls back
    to.

23. **The worker reports itself, and not through the queue.** Everything this
    deployment says about its own health used to travel through the thing most
    likely to be broken. So `BOOT_BEAT` is written straight to Postgres as the
    process starts (`apps/worker/src/heartbeat.ts`), carrying whether the queue
    was reachable and which build is running — `RENDER_GIT_COMMIT`, from the
    process itself rather than from a dashboard reporting on it, because those
    disagreed here for an afternoon and the dashboard was the one being read.

    Two stamps, because one cannot answer the question. `PACING_LOOP` is
    written by a loop that needs the queue in order to run at all, so a dead
    queue and a dead process erase it identically — and "restart the worker",
    "fix `REDIS_URL`" and "the build has not shipped yet" are three different
    people doing three different things. `describePacing` and `/app/system`
    name which. A missing boot stamp reports `unknown`, never `blocked`: it is
    also what a deployment looks like before the build carrying the stamp has
    shipped, and sending somebody to restart a healthy worker is its own
    wasted hour.

24. **Once somebody has been contacted, they are never contacted again.** Not
    "unless they replied", and not "unless it is a different campaign" — the
    second message a stranger gets from the same company under a different
    pretext is what makes the first look like a mail-merge. `last_contacted_at`
    on `prospects` is the record, and the check is in
    `apps/worker/src/jobs/linkedin-action.ts` immediately before the send, for
    the same reason the exclusion list is: two campaigns built from the same
    customer profile read `prospects` before either of them writes to it, so
    both can queue the same person quite legitimately, and there is no earlier
    moment at which the question has a settled answer. An invitation is a first
    contact by definition, so any contact at all is already too much.

    The rule stops a second conversation being opened; it never stops the first
    one finishing. It applies to invitations only — read as "never message a
    contacted person" it would silence every campaign the moment its invitation
    was accepted, which is the one outcome the campaign exists for. A person
    dropped this way is `closed` with a reason, because a name that quietly
    goes missing from a list somebody reviewed is its own bug report.

    `/app/prospects` is the history: who has been reached out to and when,
    filterable, contacted-first. Ranked by fit alone, somebody messaged last
    week sat wherever their score put them and looked exactly like somebody
    nobody had ever written to.
25. **You can send one now, and find out what happened.** `sendOneNow`
    (`apps/worker/src/jobs/send-one.ts`, behind `Send one now` on the campaign)
    takes the next queued invitation off the conveyor belt and reports the
    outcome to the caller. Eight days went by without a single live send
    because every way of asking cost a quarter of an hour — five minutes for a
    tick, two to eleven more for the jittered gap — and answered with an
    unchanged page when anything went wrong in between.

    It skips the waiting and nothing else. It runs `runLinkedInAction`, so the
    limiter, the health check, the exclusion list, do-not-contact, the
    never-twice rule and the audit log all still apply, and it refuses a
    campaign nobody has launched — otherwise it is a way around the review this
    product is built on. Every refusal is reported in words: the limiter
    declining is the system working and says so, and a provider error is handed
    back verbatim, because "422: Cannot send invitation to this member" is the
    single most useful sentence in the flow and it used to go to a log on a
    host the person pressing the button cannot reach. A run that refused
    without throwing is reported as not sent, never as success.

26. **A strategy is what a prospect came from, and a fit score means nothing
    without it.** A customer profile *is* a strategy; a business runs fifteen or
    twenty. `prospects.customer_profile_id` (migration 0016) records which one's
    search found each person, and it is a column rather than a join table
    because discovery is single-valued **by construction**: targeting excludes
    everyone the workspace already knows, so the first strategy to reach a
    person is the only one that ever can. Modelling it many-to-many would invent
    a relationship the system cannot produce, and invite code that puts one
    person on two strategies' lists — which is the duplicate contact rule 24
    exists to prevent.

    `fit_score` is a fact about a person **and** a strategy. 87 against "small
    B2B agencies" says nothing about "chamber leaders", and the number was shown
    unlabelled for months, which made it a ranking nobody could interpret.
    `/app/prospects` filters by strategy and names what each score was scored
    against; `/app/campaigns` groups by strategy in the strategies' own priority
    order; `/app/strategy` shows what each one has actually produced.

    Deleting a strategy sets the link null and **never** cascades to the people
    it found: those rows are the record of who has been contacted, and rule 24
    depends on them outliving everything else.

27. **A prospect row is a commitment, so it is never written on its own.**
    Writing one excludes that person from every future search this workspace
    runs — that is how rule 24 works — so writing it before the person is
    actually on a campaign spends the exclusion on an outreach that never
    happened. `attachProspects` used to let `personalizeInvites` throw between
    the two writes, and forty-nine real people ended up in the workspace on no
    campaign at all: unreachable, invisible, and blocking themselves from ever
    being found again. Nothing anywhere said so.

    Rule 16 already said a writer outage must degrade a campaign rather than
    stop it — `inviteNote` falls back to the template — and an uncaught
    exception walked straight past the fallback that existed for it. The failure
    is caught, the campaign is built with template notes, and
    `campaign.notes_missing` is recorded: degrading **silently** is the other
    way this goes wrong, because the review screen then shows a campaign that
    reads as personalised and is not.

28. **A campaign tests angles, not wording, and never declares a winner it
    cannot see.** Every prospect receives a note written from their own
    headline, title and company, so no two people get the same words — an A/B
    test of literal message text would be comparing one-off sentences and
    measuring the writer's mood. What a campaign can hold constant and vary is
    the **angle**: the pain named, the reason for reaching out. That is the one
    input `personalizeInvites` takes, and it is what `campaign_variants`
    (migration 0017) holds. Each angle carries its own fallback note, because
    falling back to the campaign's generic line moves that person into an
    unnamed fourth angle while the results table still counts them under the
    one they were assigned.

    Assignment is round-robin over the counts the campaign **already has**
    (`assignVariants` in `packages/shared/src/variants.ts`), never random:
    fifty prospects split randomly across two angles lands 32/18 often enough
    to matter, and the gap it invents is then read as a result. Carrying the
    running counts is what makes `Find more` sound — a second batch continues
    the rotation instead of handing the first angle another even split.
    Assignment is fixed when the list is built and **never** reassigned:
    reassignment attributes an outcome to an angle that did not produce it,
    which is the one way a test is worse than no test.

    The angle carries past the invitation. A prospect accepts *because of* the
    angle, so a generic first message would attribute the acceptance to the
    angle and the reply to nothing — the two halves of the funnel measuring
    different things. `campaign_steps.variant_id` (migration 0018) gives each
    angle its own sequence, and an angle that has one **owns it end to end**:
    when its sequence runs out, the sequence is over. Falling through to the
    campaign's step 2 would send that group an opener in one voice and a
    follow-up in another. The campaign-wide steps (`variant_id` null) are not a
    leftover — they are the whole sequence for anybody assigned no angle.

    The comparison is deliberately reluctant. Rates use a **Wilson interval**,
    not rate ± 1.96·√(p(1−p)/n), which at 0 of 8 claims perfect certainty from
    no evidence and at small n runs outside [0, 1] — precisely the range an
    early campaign lives in. An angle is called behind only when another's
    whole interval sits above its own, and only once both have cleared
    `MIN_SENDS_TO_COMPARE`. Several angles leading at once is the correct
    reading of a young test, not a bug. A rep who kills the better angle
    because it read 40% against 60% on eleven invitations has lost more than
    the test could ever have won.

29. **A CTA is the campaign's goal, and the goal decides what counts as
    success.** "Book a meeting" was the only goal this product had and it was
    wired in everywhere: the copy asked for a call, the Reply Agent proposed
    times, the funnel's last stage counted bookings. Most outreach is not asking
    for a meeting — sign-ups, a product looked at, a collaboration, a reply and
    nothing more. Bolting a URL onto a meeting-shaped campaign would leave the
    copy asking for a call and the dashboard reporting zero meetings for a
    campaign that did exactly what was asked of it.

    So `stagesFor` (`packages/shared/src/funnel.ts`) drops the meetings stage
    for a goal that can never reach it. A funnel ending in a permanent zero
    reports a working campaign as a failed one, every day, for ever.

    The goal lives on the **strategy** and the campaign inherits it (migration
    0019), because the copy is written toward the ask: a sequence built for a
    call and then switched to a link is a sequence whose first two messages were
    arguing for something else. It is campaign-level and never per-variant — a
    variant tests the angle, and varying the goal too would leave a campaign
    changing two things at once and able to attribute the result to neither.

    **A link never appears in a connection request.** LinkedIn penalises them
    there and they measurably cut acceptance, and the prompt saying so is not
    what makes it true — `containsLink` checks the text, exactly as opt-outs are
    checked. A note carrying one drops to **no note at all**, which is ordinary
    on LinkedIn, rather than having the URL surgically removed and reaching
    somebody as a broken sentence. The destination is substituted at send time
    from `{{cta_link}}`, so changing where a campaign points does not mean
    rewriting three messages and re-reviewing them — and a campaign with no
    destination leaves the placeholder **visible**, because "take a look here:"
    with nothing after it reaches a prospect looking like a broken product while
    a visible `{{cta_link}}` is caught on the review screen.

    **Clicks are not measured and never will be.** It would mean wrapping the
    customer's URL in a redirect we own, which breaks the affiliate and tracking
    parameters on the Amazon and Shopify links people actually send, and puts an
    unfamiliar domain in a LinkedIn message — spam to the recipient and to
    LinkedIn's own heuristics, on the account this product exists to protect.
    `CLICKS_ARE_INVISIBLE` is that sentence, said on the screen rather than
    shown as a zero somebody reads as failure.

30. **The agent never sends a link it was not given.** This is rule 6's
    sibling: the model may not invent a datetime and it may not invent a URL,
    for the same reason — both reach a real person under a real rep's name, and
    both are the kind of detail a language model produces fluently and wrongly.
    `acme.com/demo` is exactly what a model writes when a reply wants a link and
    none was supplied: plausible, specific, a 404, and the rep never sees it.

    `draftLinkCheck` (`packages/shared/src/links.ts`) compares every URL in a
    draft against the ones the agent was actually handed — the campaign's
    destination or the rep's scheduling link, plus anything already in the
    knowledge documents, which are the customer's own words. **Held, never
    stripped**: removing the URL leaves "you can book a time here:" pointing at
    nothing, which reads worse than the invented link did, and a hallucinated
    link is evidence the draft as a whole drifted rather than that one token was
    unlucky. Host and path are compared exactly; a dropped query parameter is
    not an invention, an added path is.

    **Which link, and whether any, follows the campaign's goal** (rule 29). A
    sign-up campaign's agent must not propose a call — that is the agent
    pursuing a goal nobody set — so a campaign not asking for a meeting is given
    no slots at all, and a conversation campaign is given no link, not even the
    rep's own.

31. **A rep's own scheduling link is allowed, and what it costs is said.**
    `profiles.booking_url` (migration 0020) takes a Calendly or Cal.com address.
    The product owns a booking page and it works, but a rep who has used one for
    three years keeps their availability, buffers and reminders there, and
    asking them to maintain a second calendar so a LinkedIn reply can offer a
    time is asking them to maintain two. Google Calendar is the option that
    cannot be built at all: its scopes need brand verification, a verified
    domain and weeks of review, which is what made the last stage of this
    product undemonstrable.

    A booking made on Calendly happens on Calendly — no webhook we are entitled
    to, nothing to poll — so a campaign relying on it **cannot report meetings
    automatically**, and the screens say so rather than showing a zero that
    reads as failure. Refusing external links to keep the funnel complete would
    be optimising the dashboard at the cost of the product: a rep who cannot
    send the link they actually use does not book fewer meetings through this
    product, they stop using this product.

32. **The product says what to do next, in one voice.** `nextStep` and
    `ONBOARDING_STEPS` have computed where a workspace has got to since the
    first week and nothing led with it: the overview showed five equal-weight
    sections and the sidebar twelve equal links, so the answer existed and was
    on no screen. `readSetupState` (`apps/web/src/lib/setup-state.ts`) is read
    once in the layout and again on the overview, so the nav and the page can
    never disagree about which step somebody is on — two readings drift, and the
    one the newcomer believes is whichever they looked at.

    There is exactly **one** mark (`markFor` in `apps/web/src/lib/nav-marks.ts`).
    A sidebar where six things are urgent has no urgent things. A disconnected
    LinkedIn account takes the mark and silences every other one, because there
    is no next step while the thing every step depends on is broken — pointing
    at Knowledge while the account cannot send points at the wrong stage, which
    is rule 17's disease in the navigation. The dot is `aria-hidden`, so every
    mark carries a `stateLabel`: unsaid, a screen-reader user gets twelve
    identical links and no indication of which one wants them.

33. **A ticket carries what the product believed, and names what it did not
    know.** `/app/support` writes to `support_tickets` (migration 0021) with a
    `context` snapshot gathered at the moment somebody pressed the button:
    which step they were on, whether LinkedIn was connected, whether the sending
    loop had run and on which build. Every failure this deployment hit was
    reported as a sentence — "I launched a campaign and nothing happened" —
    that is true of four different problems, and the person raising the ticket
    does not know which of those facts matters and should not have to work it
    out. Asking them to go and check first is asking them to do the diagnosis.

    `describeTicketContext` **names a fact it does not have** rather than
    omitting it. Four facts listed with no mention of the sending loop reads as
    a loop that was running, and sends whoever is answering to investigate the
    wrong stage — the same disease as a diagnostics check reporting `ok`
    because it could not look. `context` is jsonb, so a null, a string or an
    array can land in that column and the console still has to render.

    Answering happens **in the console**, through `answer_support_ticket` — a
    definer function whose `is_platform_admin()` check is the whole
    authorisation, exactly as rule 15's `platform_workspace_stats()`. There is
    no update policy on the table: RLS cannot restrict columns, and the
    customer's own `subject` and `body` are the one part of the row that must
    survive being replied to. An operator who has to open psql to answer has
    moved the chat window, not removed it — repair must never depend on
    somebody finding a terminal, for the same reason rule 8 says it must never
    depend on somebody finding a button.

34. **The application has its own type scale, and one heading per level.**
    It used to wear the marketing site's: `h1` clamps up to 3.25rem for a
    landing hero, and the app patched it back down with `.app-body h1`. A scale
    plus an override is not a scale — seven screens carried two or three
    `<h1>`s and nine of sixteen wrapped their title in `page-head` while the
    rest did something else, which is what a person reads as "a title, a mini
    title and a title under the title". A page with three h1s has no heading,
    because nothing is above anything else.

    `PageHeader` and `Section` (`apps/web/src/components/page.tsx`) are the only
    places an `<h1>` and an `<h2>` may appear, and they set their own spacing,
    so two screens cannot drift apart. Three levels — page, section, card — and
    a fourth is really a new section. `apps/web/test/page-structure.test.ts`
    enforces it over every page, because a convention nothing checks drifts
    back within a month.

    The app's face is its own too. A landing page is read once and wants
    character; a dashboard is worked in daily and wants to disappear. Geist has
    real tabular figures, which is why a column of numbers no longer has to be
    set in a monospace to line up — and why the tables stopped looking like
    code.

35. **A chart is drawn from a scale this repo owns, and its colours are
    computed.** `apps/web/src/components/charts.tsx` is inline SVG and no
    library: four shapes is less code than a dependency's configuration, and a
    chart built on our own scale cannot draw a bar whose length disagrees with
    the number printed beside it.

    The funnel is **bars on a shared scale, never a trapezoid**. A trapezoid
    encodes its numbers as area, so a stage holding half as many people looks a
    quarter as big — it misrepresents the one thing it exists to show. Every
    value is written next to its own mark, so nothing depends on reading a
    length against an axis, and one axis only: two y-scales on one chart is the
    most common way to imply a relationship that is not in the data.

    Series colours live in `--viz-1..4` and were **run through the validator**
    in both modes, not chosen by eye — a lightness band so no series vanishes
    into the surface, a chroma floor so none reads as grey, and a colour-blind
    separation between every adjacent pair. Light and dark are separate steps
    of the same hues picked for their own surface, never an automatic flip.
    Fixed order, never cycled: a fifth series folds into "Other" rather than
    inventing a hue.

36. **A workspace keeps several calls to action, and a campaign picks one.**
    The goal arrived as three loose columns on the strategy and the campaign
    (`cta_kind`, `cta_label`, `cta_url`), which works for a business with one
    ask. Nobody has one ask — the same company runs a free-audit link, a
    sign-up, a book-a-call and a product page, and each campaign retyped its
    destination, so a URL corrected in one place stayed wrong in four with no
    screen able to say which campaigns pointed where.

    `ctas` (migration 0024) is the row somebody names once; `campaigns.cta_id`
    points at it and rule 29's `{{cta_link}}` reads through the pointer at send
    time, so fixing a typo fixes every campaign using it without rewriting a
    message or re-reviewing copy a human approved. The link is `set null` and
    **never** cascades: deleting a destination must not delete the campaign
    that used it, and a CTA is archived rather than deleted, because a campaign
    that used one still has to be able to say what it pointed at.

37. **Three strategies is where a workspace starts, not where it stops.**
    The Strategy Agent writes three to five — the right number to read and
    approve in one sitting, and the wrong number to run a business on, which
    works fifteen or twenty segments. `expand` on `StrategyJob` asks the same
    agent for more.

    Three things make that worth having. It **extends the existing business
    profile** rather than inserting a second, because every strategy hangs off
    that row and a workspace with two has its list split across both — which is
    what a plain re-run did. A returned strategy whose name repeats one already
    here is **dropped, not stored**: two strategies covering the same people
    put one person on two lists, and rule 24 then means the second finds
    nobody, so it is a strategy that can only ever report zero. And priorities
    **continue from the end of the list**, or four new strategies each claim to
    be the one to pursue first.

    The agent is handed the names that already exist. Asked for more without
    being told what is there, a model returns the same three with different
    nouns — and the event records how many were kept against how many repeated,
    because "asked for four and stored one" needs looking into and "stored
    four" does not.

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
