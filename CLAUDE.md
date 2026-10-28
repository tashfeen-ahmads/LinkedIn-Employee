# LinkedIn Employee — working notes

An AI SDR for LinkedIn. Read `README.md` for what it is and `docs/` for the
plan. This file is for whoever works on the code next.

## Commands

```bash
pnpm install
pnpm build          # packages compile to dist/; apps typecheck against those
pnpm typecheck
pnpm test           # ~1,760 tests, no network, no API key needed
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

   The provider's account *list* carries no reference at all, and its `name`
   there is the LinkedIn display name, so on the pull path nothing ever
   matched and recovery repaired nobody. The id that does identify a rep's
   account is the one their own signed return to `/auth/linkedin/done`
   carries: when the claim there is refused (the list lagging), it is kept as
   `pending_provider_account_id` (migration 0055) and `accountsForRep` claims
   it on the next Team page load or nightly run, once the provider lists it
   and no other row holds it. A display name is never a match.

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
   writes profiles; it does not approve them. A person approves them, on
   `/app/strategy` or on onboarding's approval step (rule 65), and both go
   through `approveStrategy` (`apps/web/src/lib/approve.ts`) and show the
   competitor check (rule 49). Nothing else approves one.

   Nothing blank reaches that screen. Sage needs a website or a description
   (a LinkedIn page alone is a URL nothing here can read), reads the exact page
   it was given before the site's usual ones, and a run returning an empty
   business or a nameless strategy fails in words instead of storing it: a
   LinkedIn-only signup was shown a strategy with no name, an Approve button,
   and an offer written from nothing. `approveStrategy` refuses a nameless one.
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

    **A lookup takes a real match or nothing** (`matchParameter`). It took
    LinkedIn's first suggestion, so "New York, NY" was searched as Nyack and a
    city campaign quietly became a small town's. An exact title wins; a place
    also matches on its first segment plus every region it names; anything
    else is dropped with a note. Only matches are cached.
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
    insert policy, so it takes the service role. The worker is the one path
    (`apps/worker/src/jobs/admins.ts`, migration 0054): an **owner** adds,
    changes and removes admins from `/admin/team`, the last owner can be neither
    demoted nor removed, and somebody without an account is invited by address
    and claims it only when signed in with that address, read from their own
    profile. Roles are `owner`, `admin`, `support` and `viewer`
    (`packages/shared/src/admin-roles.ts`); the worker checks the role on every
    control and announcement, and the console only hides what a role cannot
    press.

    An owner can hide a workspace from every console list
    (`console_hidden`, migration 0062; the `workspace-console-hidden` control,
    owners only) for the platform's own test and demo accounts. Every list
    filters through `hiddenWorkspaces`/`shown` (`apps/web/src/lib/admin.ts`)
    and Issues drops their rows; spend totals stay whole because that money
    was spent. Only the service role may change the column (a guard trigger),
    or a customer could hide themselves from their own support. Settings lists
    what is hidden and shows it again.

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
    accounts the provider holds. Neither may the table it reads: members see
    only the `campaign-tick`, `worker-boot` and `webhook:messages` heartbeats
    (migration 0056), because `accounts:observed` holds every connected
    account's LinkedIn name and was readable by every signed-in person.

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
    **A running campaign refills itself.** `refillCampaigns`
    (`apps/worker/src/jobs/refill.ts`, hourly) continues the same search under
    Find more's own job id once a campaign has fewer than two days of
    allowance queued, at most once a day per campaign, and never after
    `search_exhausted`, and never for a workspace that cannot send, while
    outreach is paused, or for a strategy not approved or set aside. Two days
    is counted **per account**, across every campaign sending from it, and a
    campaign launched in the last day is left alone: one free account with
    eleven days queued over five campaigns was still refilled, and every row
    refill writes takes a person out of every future search (rule 27). Lists only
    grew when somebody pressed the button, and
    by late October three of seven running campaigns had nobody left to invite
    while every owner read the ramp as broken.

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
    queue counts too, because a stable job id per prospect is what stops a
    second tick queueing the same invitation, and BullMQ accepts an add whose
    id is already taken without replacing the job: one failed action keeps its slot for the
    whole `removeOnFail` window, so that person is never re-queued while every
    screen reports a healthy loop. The counts are the only place that shows.
    It also carries `inFlight`, today's queued invitations per account and
    campaign, which the campaign page nets off the "more today" it promises;
    reading them out of the decision sentences was a second reading capped at
    twenty campaigns. The decisions and `inFlight` are written to
    `campaign-tick:detail` (`PACING_DETAIL`), which only platform admins read,
    never to the row every member can: they name every workspace's campaigns.
    A member gets their own account's count through `pacing_in_flight`
    (migration 0059), whose membership check is the whole authorisation, and
    `/app/system` shows only the caller's own campaigns' decisions. The page
    never promises more today than the day's allowance less what was sent,
    because the stamp can be minutes old and count a sent invitation as
    queued.

    A job's due time is the `dueAt` it carries (`jobDueAt`), written when it
    is placed and again by every reschedule (`rescheduleJob`). BullMQ's
    `moveToDelayed` keeps the original `timestamp` and makes `delay` relative
    to the move, so `timestamp + delay` read rescheduled invitations as due
    hours early, charged them to the wrong day, and placed the rest at the
    send path's floor instead of the day's pace.

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
    limiter, the day's pace (rule 64), the health check, the exclusion list,
    do-not-contact, the never-twice rule and the audit log all still apply, and it refuses a
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
    a visible `{{cta_link}}` is caught on the review screen. Visible on the
    screen, never in the send: a follow-up whose rendered text still carries
    any `{{…}}` is held as copy (rule 66).

    **The label is a button's name, never a sentence.** "If yes, Book a Free
    Consultation and pick a time:" is what a writer told `Name it as "<label>"`
    produces. The writer asks in plain words, `titleCaseCta` flags the label
    pasted mid-sentence, the send path holds a follow-up that still carries
    it (as copy, rule 66), and the label never goes into a campaign's name.

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

    A rep with their own link is **never offered built-in times beside it**,
    and an acceptance is never booked on the built-in calendar for them: that
    calendar cannot see the diary their link manages, which is rule 18's
    double-booking by another door.

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

    One business profile per workspace does not mean one brand. An agent may
    carry its own `brand_name` and `brand_description` (migration 0047), and
    `businessFor` (`apps/worker/src/brand.ts`) lays them over the workspace's
    profile wherever a writer is handed "the company" for that agent's work —
    replies, pitches, openers, invite notes, the agent test. A branded profile
    drops the workspace's pricing, proof points and differentiators rather
    than lending them to another product (rule 11); an empty description is
    the workspace's own business. Strategies never read it: they still hang
    off the one business profile.

38. **One stylesheet, one definition per class.** A class declared twice is
    not a duplicate, it is a silent override: the later rule wins on source
    order, the earlier one stops mattering, and it happens on a page nobody
    edited and shows up nowhere in a diff of that page. Four were live at once
    — `.section` meant "a band of the landing page with 4.5rem of padding"
    until the application redeclared it as a flex column and took that padding
    off the whole marketing site; `.chart` meant "a bordered, padded card"
    until a figure redeclared it and started rendering a box inside a box;
    `.site-footer`, `.wordmark`, `.footer-grid` and `.hero-panel` each had a
    definition that had never applied to anything.

    That is precisely what somebody sees as "some have a lot of padding, some
    have none". It is not a series of small mistakes, it is the absence of a
    check — so `apps/web/test/stylesheet.test.ts` is the check. Grouped
    selectors are exempt, because `h1, h2, h3 { line-height }` followed by
    `h1 { font-size }` is a scale being built rather than a collision.

    The marketing pages and the application share this file and several names,
    so **the application's frame is scoped under `.app`** — `.app .section`,
    `.app .page-header`, `.app .empty`. Unscoped, the app's meaning of a word
    wins on every page in the product. And colour never appears as a literal
    outside the token block: a hex in a component rule is a colour that only
    works on one ground.

39. **A job id is built by `jobId()`, never written by hand.** BullMQ reserves
    `:` for its own key namespacing and **rejects a custom id containing one**
    — by throwing from `add()`, not by generating a fallback. Every id in this
    worker was written as a template literal, `invite:<uuid>`, so every enqueue
    carrying one threw: invitations, follow-ups, replies, launches, inbound
    messages. Nothing with a custom id had ever been queued. That is the whole
    reason this deployment had sent nobody, through eight days, two live
    campaigns and a full audit that checked the routes rather than the ids.

    Two things made it invisible. `enqueueInvites` throwing looks identical
    from every screen to a campaign correctly waiting out its gap — which is
    rule 21's disease, and rule 21 is also what caught it: the pacing loop
    stamps its heartbeat *even when the run throws*, and the detail read
    `failed: "Custom Id cannot contain :"` in plain words on `/app/system`. It
    would otherwise still be undiagnosed.

    The id has to stay stable and unique per unit of work, because it is what
    stops a second tick re-queueing an invitation. So a colon inside a part is
    **replaced, never dropped**: dropping could map two different ids onto one,
    and two units of work sharing an id means the second is silently skipped —
    a real invitation that never sends.

    `apps/worker/test/job-id.test.ts` checks the helper *and* greps every
    enqueue in the worker, because the bug was in the call sites rather than in
    any function. A unit test of the helper alone would have passed throughout.

40. **The offer is written once, approved by a person, and made to everybody.**
    The invitation may not pitch and the first message after an acceptance may
    not either — both are enforced in the Targeting Agent's prompt, and both are
    right: a paragraph arriving seconds after somebody accepts reads as a
    sequence, and the reply rate of a sequence is the reply rate of an advert.
    So the product already said, in as many words, that the pitch is sent when
    they reply and not before.

    The pitch itself was nowhere. `draftReply` was handed the business profile
    and left to argue for the product from it, which it did slightly differently
    every time — so every prospect who ever asked "what is this?" received a
    different proposition, and the one piece of copy in the product that
    actually sells the thing was the only piece nobody had read.

    **A pitch is a line, and a workspace keeps several** (migrations 0026 and
    0027). One pitch is an opinion nobody can check; several are a test. And
    because an angle owns its prospect end to end (rule 28), the line somebody
    hears is the one on `campaign_variants.pitch_id` — the angle their
    invitation was written for. A prospect accepted because one pain was named,
    and an offer arguing a different one leaves the acceptance and the reply
    measuring different things. A prospect assigned no angle hears the
    workspace default, exactly as the campaign-wide steps are already the whole
    sequence for that person; `pitches_one_default` is a unique index, because
    "which pitch" answered by row order is answered differently on different
    days.

    **`PITCH_MAX_CHARS` is 90, and it is enforced in code.** A pitch is spoken
    into a chat window on a phone, two seconds after somebody asked what this
    is; a paragraph there is skimmed and then ignored, which looks exactly like
    one that was never sent. The zod `.max()` is documentation for the model and
    nothing else — `callStructured` **casts** its result rather than parsing it,
    and a provider's structured-output subset enforces the shape of the JSON,
    not `maxLength` on a string. That is the same hole that sent a 222-character
    connection note to LinkedIn and had the invitation refused, which is why
    `personalizeInvites` carries the identical second check. Over-length lines
    are **dropped, never truncated**: cutting one mid-clause reaches a prospect
    as a broken message under a real rep's name.

    `writePitch` writes it and **does not approve it**, exactly as the Strategy
    Agent writes customer profiles and does not approve those (rule 9).
    `loadPitch` returns nothing at all for a row whose `approved_at` is null, so
    an unapproved draft is never sent and the approval screen is not decorative.
    Editing the words clears the approval in a **trigger**, not in the action
    that happened to save them: an approval is a statement about particular
    text, and without that one approval in September authorises every rewrite
    after it.

    It is handed over as text to **adapt, never to recite** — the prospect asked
    a specific question, and a pitch pasted underneath it answers a different
    one — but the substance is fixed. It rides in the cached half of the prompt,
    because it is identical for every conversation in the workspace. And a link
    inside it is an **allowed** link (rule 30): it is copy a person approved, and
    without that the agent is held for quoting the text it was told to use.

    `factsUsed` is what makes "is this true" checkable rather than a matter of
    opinion, and an empty one is **reported on the screen**, exactly as rule 16
    reports empty grounding. A pitch that cites nothing looks precisely like one
    that cites everything.

    **The opener gets exactly the same treatment** (`hooks`, migration 0028),
    because it is the same object with different words in it: written by an
    agent, approved one line at a time, retired without deleting, attached to an
    angle through `campaign_variants.hook_id`, one default per workspace. The
    two are resolved by identical rules on purpose — the opener and the offer
    are two halves of one bet, and resolving them differently is how they come
    apart. `HOOK_MAX_CHARS` is 120 rather than 90 and must stay below
    `INVITE_NOTE_MAX_CHARS`: LinkedIn refuses the whole invitation at 200, and
    rule 16 says the note still has to say one specific thing about the person,
    so an opener that fills the note leaves nothing for them. An opener carries
    **no pitch, no product claim and no link** — checked in the prompt and, for
    length, in code.

    Every strategy had carried three since the first week (`spec.hooks`,
    rendered on `/app/strategy` under "Opening angles"), written by the agent,
    approved by a person — and nothing ever read one. Written, stored,
    approved, displayed, then dropped at the single moment they mattered, which
    is precisely what rule 16 says happened to the prospect research before
    `personalizeInvites` existed. Living in a strategy's jsonb they could not be
    approved, retired or attached individually either. They are now rows, and
    the strategy's own remain the fallback so a workspace that has written none
    keeps the behaviour it had.

    The invite writer is handed **the whole approved set, the angle's own
    first** — never a single line. Given one, it has a template again and
    everybody in the batch receives the same sentence. They are **shapes to lean
    on and never text to paste**, which is what the prompt says and what rule 16
    already required of every note.

    **An opener belongs to its audience.** Once one opener was approved it
    replaced every strategy's own, so recruiters were asked "do founders still
    run outbound where you hire". The angle's attached opener and the
    strategy's own lead; agent and workspace openers go to the writer only as
    `otherOpeners`, to use where their question fits the person.
    `openerProblems` (`packages/shared/src/voice.ts`) refuses a note that
    borrows five words running from another audience's opener or pastes its
    own; a campaign built from an existing list gets a note written for each
    person at build time, never the agent's opener pasted for everyone.

    A campaign step carries `{{pitch}}` rather than a copy of the words, for
    rule 36's reason: a business that retyped its offer into each campaign would
    have four versions of it inside a month and no screen able to say which
    prospect got which. But `renderPitch` **refuses** where `renderCta` shrugs,
    and the asymmetry is the point. A missing destination costs a link, and a
    visible `{{cta_link}}` is caught on the review screen. A missing pitch is the
    entire body of the message: what goes out is the literal characters
    `{{pitch}}`, or a greeting with nothing after it, to a real person under a
    real rep's name. So the follow-up is **held, not failed**, and its schedule
    is untouched — approving a pitch is the whole of what it takes to send it,
    and there is no second chance at a first follow-up.

41. **A hold is a full stop, so a workspace can choose to have none.** The
    reply gate held for a person on pricing, legal, negative sentiment and the
    model's own `needsHuman` — sensible defaults for a team watching an inbox,
    and a dead end for the ones that are not. A prospect who replies "how much
    is it?" on a Friday and is never answered is not a conversation being
    handled carefully; it is a warm lead lost, and the funnel reads 0% for a
    reason no screen explains.

    `autonomy` on `RulesOfEngagement` is that choice. `autonomous` reads the
    model's `needsHuman` as advice rather than as a veto — it is a summary of
    the same structured fields the flags already cover, so leaving it in place
    would make turning the flags off do nothing, which is how a setting comes
    to exist and change nothing.

    It changes **who finishes the sentence, never what the sentence may
    contain**. The knowledge base is still the only source of product facts
    (rule 11), `draftLinkCheck` still holds an invented URL (rule 30), and
    `applyRules` stays pure (rule 5) — autonomy is one more field it reads.

    **Two holds survive autonomy, and they are not the same kind of thing.** A
    message below the confidence floor is held because the agent does not know
    what was said, and a reply written from a misread message reaches a real
    person just as fast as a good one. A prospect who asks to speak to a human
    is held because *they asked*: that one is not our caution, it is their
    wish, and answering it with another machine-written message is a promise
    broken under a real rep's name. An opt-out still stops everything (rule 7).

42. **The agent repairs its own queue.** A campaign prospect moves because
    `next_action_at` says when, and a row can lose it: a job that threw between
    the send and the reschedule, a delay computed by a version of the code that
    got it wrong, a step deleted mid-sequence. Nothing noticed. The prospect
    sat in `accepted` for ever, the campaign reported `running`, and the funnel
    read zero — which whoever launched it correctly read as the agent doing
    nothing. The first live acceptance landed in exactly that state.

    `unstickProspects` runs hourly beside the acceptance poll and again in the
    nightly sweep, because a stall is the one failure invisible from every
    screen. Repair must never depend on somebody finding a button (rule 8) and
    it must never depend on somebody writing an UPDATE by hand either.

    Three things it must not do. It never **brings a schedule forward** — only
    a missing or long-overdue one is re-armed, or every configured delay
    collapses to now and a fortnight's pacing sends in an afternoon. It never
    **invents a step**: the end of a sequence is an answer, and inventing one
    messages somebody twice. And it never touches a `closed`, `failed` or
    `opted_out` row — those are outcomes, and restarting one writes to a person
    who has already been dealt with, or who asked us to stop.

    A row closed because its sequence ran out is the one closed row a reply
    moves: somebody answering the last follow-up is that campaign's reply,
    answered under its mode, goal and agent and counted in its funnel. Read as
    "no campaign", it fell back to approval, a meeting and the workspace's own
    business. Rows closed for any other reason stay closed.

    The one schedule it does pull earlier is a first message an older rule
    pushed days out (rule 43). There is no rep's judgement to collapse there —
    step 1 has exactly one correct answer — and it stays narrow: `accepted`,
    never messaged, and only beyond the window the rule allows.

43. **The first message after an acceptance is not on a schedule anybody sets.**
    Each campaign step waits `delay_days` before sending, measured from the
    message before it — which works from step 2 on and is meaningless for step
    1, because there is no message before it. What precedes step 1 is the
    acceptance, which is the event the whole campaign exists to produce.

    Left configurable, the Targeting Agent wrote `3` into step 1 of every
    campaign this deployment has ever built. A stranger accepted a connection
    request, heard nothing for three days, and then received an opener about a
    conversation they had forgotten starting. Three accepted invitations were
    sitting in exactly that state while the funnel reported no messages and no
    replies — which reads from every screen as an agent doing nothing, and is
    what "there must not be a 0% rate on connections accepted" means.

    So `FIRST_STEP_DELAY_DAYS` is a product rule, enforced in code rather than
    asked for in a prompt — `callStructured` casts rather than parses, so the
    prompt saying "follow-up 1 goes out the moment the connection is accepted"
    had been true in the prompt and false in the database for months. It is
    discarded **at the write as well as at the read**: a campaign screen reading
    "3 days" for something that happens within the hour is a second reading of
    the rule, and the screen's is the one somebody believes. `acceptFollowUpMin`
    /`MaxMs` remain the window — twenty to ninety minutes, jittered, with the
    working-hours check on top. Steps 2 and beyond keep their configured delays
    in full: those are measured from a message that really was sent.

44. **A job id stops a second tick; it must never stop every tick.** The pacing
    loop runs every five minutes and gives each unit of work a stable id, which
    is what stops it queueing an invitation the previous run already queued
    (rule 21). BullMQ implements that by accepting an `add()` whose id is taken
    and **silently returning the existing job** — correct while that job is
    waiting, and catastrophic once it has finished.

    Completed jobs are kept a day and failed ones a week. So an invitation that
    ran and came back without sending — any of the silent `return`s in
    `runLinkedInAction`, a provider refusal, a throw past its retries — leaves
    its prospect at `queued` with the id held by a corpse, and every tick after
    that adds nothing and reports the same cheerful zero. Seven real people sat
    in that state through a full working day while the loop, the queue counts
    and the campaign screen all looked healthy. Rule 21 put the counts on a
    screen, which told somebody a number was wrong; it did not put anybody back
    on the conveyor belt, and repair must never wait for that (rule 8).

    `enqueueOnce` asks **before** adding, because `add()` gives no sign it
    declined — a job created this second and one from an hour ago come back
    indistinguishable, and telling those apart is the whole job. A terminal
    state with the row still waiting is the evidence: the work is over and the
    prospect still needs doing, so the id is stale, and the job is removed and
    re-added. `waiting`, `delayed` and `active` are left exactly alone — that is
    the dedupe working. A state that cannot be **read** is also left alone:
    unknowable is not stale, and acting on it is how one unit of work becomes
    two messages to the same person. It cannot double-send in any case, because
    a job that really did send stamped `last_contacted_at`, which the never-twice
    check reads immediately before the call (rule 24).

    The three outcomes are reported separately. `queued 7` while seven jobs sat
    finished in Redis is the sentence that cost the day.

45. **The loop's record has to survive the next quiet run.** `worker_heartbeats`
    keeps one row per name, upserted — the right shape for "is the loop alive",
    and useless for "what did it do today". The loop declines most of its runs
    correctly, so by evening the row says `outside_working_hours` whatever
    happened at eleven, and a run that threw at two is erased by the healthy
    decline at five past. That is not hypothetical: the day above was
    investigated after the only record of why had already been overwritten by a
    run that correctly did nothing.

    So a run that **sends** stamps `PACING_LAST_ACTION` and a run that **throws**
    stamps `PACING_LAST_FAILURE`, and no quiet run writes either. "Nothing since
    11:04" and "nothing ever" are different situations; so are "failing every
    five minutes" and "fine". The single row reported each pair identically.

46. **A check about the webhook asks whether deliveries arrive, not whether a
    secret is set.** Failing closed is right — a forged delivery writes a
    stranger's words into a rep's inbox under a real name (rule 8) — but the
    refusal was said to nobody. Unipile called this deployment carrying no
    signature header at all, the worker answered 401 exactly as it should, and
    the only trace was a heartbeat row no screen read. A prospect's reply was
    live on LinkedIn and absent from the product's own inbox while
    `/app/system` reported the webhook healthy, because the check asked whether
    `UNIPILE_WEBHOOK_SECRET` was configured and it was. A check that passes
    because it could not look is rule 17, and it costs the same week every time.

    `webhook-deliveries` reads what the endpoint itself recorded, and tells the
    two refusals apart by whether a signature arrived: **no header** is the
    webhook configured without one, **a header that does not verify** is the
    wrong secret on one side. Different people, different things to go and do,
    and telling somebody to re-copy a secret that is already correct is its own
    wasted afternoon. Never called at all reports `waiting`, never `ok` — a
    campaign that has had no reply yet and a webhook nobody ever pointed here
    look identical from that row.

47. **A wrapper that only carries an anchor must not change the page's
    rhythm.** A page is a flex column and its gap falls between its direct
    children, so wrapping two sections in `<div id="team">` makes the pair one
    child: spacing either side of them and none between them. Every section
    merged into Profile and into the overview ran straight into the next, which
    is precisely what somebody reads as "some have a lot of padding, some have
    none".

    `PageGroup` is the fix, in the frame rather than as a margin on each page
    that merged something (rule 34), and it takes the page's own `--app-gap` so
    a group is transparent to the rhythm instead of inventing a second one.

48. **A daily cap says how many; something has to say when.** The ramp (rule 3)
    decides an account's allowance for today and nothing decided how that
    allowance was spread, so the pacing loop enqueued the whole of it in one
    run at `nextGapMs` apart — two to nine minutes. Ten invitations therefore
    went out inside an hour and a quarter, starting whenever the tick happened
    to fire. This deployment's first live account sent seven connection
    requests between 16:52 and 17:19 on the day it sent its first ever action,
    LinkedIn began refusing invitations from it, and was still refusing five
    days later with five outstanding and seven sent all week. A daily ceiling
    with no pacing underneath it is a burst with a maximum size, and the burst
    is what the platform watches for.

    `spreadGapMs` divides the working time left today among the day's
    allowance. Three things about the arithmetic are load-bearing. The divisor
    is the **allowance**, never however many prospects happen to be eligible in
    this tick — a warmed prospect becomes invitable in its own 45-minute-to-4-hour
    window, so most ticks see one or two, and dividing by the trickle would
    place a single invitation hours out while the next tick queued its own on
    top at a rate nobody chose. `nextGapMs` stays the **floor**, so a campaign
    launched at twenty to five collapses back to the old cadence rather than
    placing invitations seconds apart. And the jitter's own ceiling is **in the
    divisor**, which is what makes the day's fit a guarantee instead of an
    average: dividing by the count alone puts the *expected* last invitation on
    the edge of the window, so every second day pushes its last few past the
    end of the rep's hours where the send path defers them and the allowance is
    quietly not spent.

    Warm-up views are deliberately **not** spread this way. A view is only
    worth its allowance if the invitation can still follow it inside the four
    hours that make it a warm-up, and the spacing that matters there is the
    per-prospect wait stamped after the view, not the gap between two views.

    The first invitation of a run on an account that has never sent goes
    within seconds (`FIRST_SEND_MIN_MS`/`MAX_MS`): there is no gap to serve.
    It used to count as sent this instant and wait a whole gap, so every first
    launch showed nothing on LinkedIn for eight to twenty-two minutes.

    **Never faster than a whole day's pace** (`dayMs`/`dayAllowance` on
    `InvitePace`). Divided only by what was left, a campaign launched at 1:21
    in the afternoon packed a never-used account's first ten into the
    afternoon, sixteen minutes apart, and LinkedIn refused the fourth. A late
    start now sends fewer today, not the same number faster. And the gap is
    **between two sends**: the first of a run is measured from the account's
    last invitation, not from the tick (and not from a profile view — rule 64).

    Views are bought only for invitations that can follow them: no more than
    the pace can invite inside the warm-up window and before close. Views for
    the whole allowance in a morning cluster, with invitations spread across
    the day, left the later ones stale and those people were viewed twice.

    `invitePaceMs` is one definition with two readers, for rule 21's reason.
    The loop jitters it into a delay; `describePacing` states it as the wait
    somebody is about to sit through. Read off `checkAction` alone the campaign
    page promised the next invitation in three minutes while the loop had
    placed it forty-five out — and the screen's number is the one somebody
    believes, so what they conclude three quarters of an hour later is that the
    product does not work.

49. **A customer is somebody who would pay, not somebody who resembles the
    company.** The Strategy Agent reads what a company publishes about itself,
    and a website describes that company's world — its vocabulary, its thesis,
    the problem it was founded on. Asked for "Customer Profiles" from that
    material, a model returns the segments that share the worldview, and the
    people who share a company's founding insight are the other people building
    the same thing. Its customers are the ones who *have* the problem, and they
    usually do not talk about it in the company's language at all.

    This deployment did it inside one response. The business profile listed
    `competitors: ["LinkedIn", "BNI and traditional in-person networking
    groups", "Manual referral tracking"]` and the priority-1 customer profile,
    which a person then approved, was "Networking group leaders & organizations
    (BNI chapters, Chambers, masterminds)". Two fields of one answer
    contradicting each other, and nothing compared them.

    **The fit scorer cannot rescue it, and that is the part to understand.** It
    scores each prospect *against the customer profile*, so a peer-shaped
    profile makes peers high-fit by definition — its own "disqualify a
    competitor" rule is measured against the very thing that is wrong. A bad
    strategy is not a strategy the filter can save; it is the filter's
    definition of good. So the fix is at the strategy, and the check is before
    approval.

    Three things carry it. The prompt names the trap rather than hoping: a
    competitor matches an ideal customer profile almost perfectly — same titles,
    same industry, same size, often the same headline — so on title match they
    are the best prospects in the list and the last people who should be
    written to. `whatTheyBuy` and `insteadOfToday` are the two fields a peer
    cannot fill honestly, which is why they exist; everything else on that
    schema reads identically either way. And `competitorTargeting`
    (`packages/shared/src/audience.ts`) compares the segment's identity against
    the company's own named competitors, on the approval screen.

    It searches the **identity** fields and never the `pains`. A competitor
    named as a pain is not a mistake, it is the point — "they track it in a
    spreadsheet" is precisely why somebody buys — and flagging it would train
    people to click past the warning, which is worse than having none. Naming
    what a segment uses today is targeting by need; naming a segment *as* that
    thing is targeting by resemblance.

    It **reports and never refuses**. Licensing a white-label engine to the
    chambers you also compete with is a real go-to-market, and a check that
    blocked it would be wrong about a business it knows nothing about. What is
    never acceptable is that it was approved with nobody told — rule 12's
    principle exactly.

    `parseCustomerProfile` is how the two new fields shipped without stopping
    the product. `targeting.ts` parsed a stored spec outright, so a new required
    key would have thrown on all seven strategies this deployment already had —
    prospecting stopped on every workspace to gain a field. A backfill alone
    leaves the window between migration and deploy, where old code writes an
    old-shaped row that new code refuses to read. Defaulting at the read closes
    both, for ever, and a null is reported on screen as unsaid rather than
    rendered as agreement. A spec still unreadable once those keys are filled is
    genuinely broken and still throws, because that is what gets it retried and
    recorded instead of turned into a quiet "nothing to do".


50. **One list answers "what needs me", and one function produces it.** The
    overview opened with a next-step card, a strategy panel, a six-item
    checklist, a row of counters and a table — five sections of equal weight,
    with the answer to "what is stopped until I do something" distributed
    across all of them plus the sidebar's single dot. Every fact was already in
    the database. Nobody had assembled them into a list.

    `needsYou` (`packages/shared/src/needs-you.ts`) is pure for the reason
    `report.ts` is: three callers read it — the overview, the nav's count, and
    the weekly email later — and three assemblies of one question disagree,
    with the rep believing whichever they looked at.

    A blocker sorts first: while the loop is down or the account is
    disconnected, every row under it is a job that cannot finish. But **nothing
    is hidden**. Rule 32 lets a disconnected account silence every other *mark*,
    because a sidebar with six dots has no dots — this is a to-do list, and
    dropping work from one because other work exists is how something waits a
    fortnight. Ordered, never filtered. Within a tone the order is fixed rather
    than by count, because a list that re-sorts as numbers move is one somebody
    has to read from the top every time.

    Zero rows is the good day and gets a sentence, not an apology: a dashboard
    that looks broken when everything is fine teaches people to stop opening it.
    Every row names **what happens if nobody does it** — "1 strategy needs
    review" is a chore, "nothing is searched for until one is approved" is a
    reason.

    The nav keeps **one** number, which is the Inbox badge. The plan called for
    a second carrying "how many things need you", and writing it made the
    argument against it: 8 beside 3 invites arithmetic nobody wants to do, and
    the two answer different questions that do not sum. Rule 32's point about
    marks, applied to counts.

    Two readings were already live and wrong. The inbox lists *conversations*
    (rule 10), while the badge and the overview's "Waiting on you" counter both
    read `reply_drafts` where `status = 'pending'` — so a conversation flagged
    with no draft, which rule 10 says happens, was shown in the inbox and
    counted by neither, and a stale draft on a cleared conversation was counted
    by both and appeared in neither.

    **A hold has three kinds, not two** (migration 0035). A follow-up built from
    `{{pitch}}` with no approved pitch is held rather than failed (rule 40) and
    was flagged as a *reply* — so it appeared in the inbox as a conversation
    needing an answer, with no draft in it, because the message was never
    rendered; the only useful action was on another screen and nothing said so.
    `clearHold(id, "reply")` matched it too, so a manual reply cleared a hold
    that was never about replying and every screen reported the conversation
    dealt with until the next tick re-held it. `copy` is that third act:
    approving a line, not writing one. Asserted on the real send path rather
    than against `flagForHuman` — rule 39's lesson, that the bug lives in the
    call site and a test of the helper passes throughout.


51. **The guardrails are the product, so they are on the screen every day.**
    Caps as product rules, the ramp from first action, the escalating backoff,
    the warm-up on its own allowance, a day's work spread across the day — all
    of it is invisible unless it fails. The category's dirty number is that a
    third of one competitor's reviewers report being restricted inside ninety
    days, and a customer who cannot see the guardrails has no way to tell this
    product from the one that got them banned.

    `AllowanceMeter` draws each allowance against **its cap**, never against the
    largest value seen: a meter scaled to its own data always looks full, and 12
    of 35 and 12 of 12 are then the same picture. Colour is earned above four
    fifths, because a bar that is amber at 40% teaches somebody to ignore amber
    — rule 32's argument about marks, applied to a chart. The ramp's day is said
    in words, since rule 3 measures it from an account's first action and
    nothing on any screen could explain why a three-week-old connection still
    sits at the starting cap.

    The overview carries the short version (`AccountSafety`: today's and the
    last seven days' invitations against their caps, and the ramp in one
    sentence); every meter and the charts are on `/app/analytics` (Results),
    read through the same `readAllowance`, so the two cannot disagree. The
    overview is for somebody who does not run outreach for a living: counts
    before percentages, and no chart a layperson has to decode.

    `StackedDays` answers "are we sending" and "is it working" in one column per
    day, because reading them off two charts means eyeballing one date against
    another. The empty days keep their slots: dropping them joins Friday to
    Monday and draws a weekend that looks like steady sending.

52. **The sequence is drawn, not dragged.** Every competitor ships a
    drag-and-drop canvas and the canvas is the demo — it is the one screen that
    makes "an automated sequence" something a person can picture. This product
    had the same sequence as a table of rows with a `delay_days` column, which
    reads as configuration rather than as a conversation.

    Drawn rather than dragged **deliberately**. A canvas implies every
    arrangement is available and most are not: a link may never appear in a
    connection request (rule 29), the first message after an acceptance is not
    on a schedule anybody sets (rule 43), and a warm-up view has to land before
    the invitation rather than wherever it was dropped. A builder offering those
    would be offering a campaign this product refuses to send — and a refusal
    that arrives after the work is worse than never offering it. The value of
    the canvas was always the picture. So the steps a person owns are theirs to
    edit, and the ones the product owns carry the reason they are not.

53. **A scoped rule is not a safe rule.** Rule 38's check compares whole
    selectors, and the expensive collision is not a whole selector.
    `.meter` is a 4px progress bar with `overflow: hidden`; a new component
    declared `.app .meter` for a labelled allowance with a value and a note.
    Both applied — the scoped rule won on specificity for the properties it
    set, and the properties it did *not* set came from the older rule, so the
    component rendered as a 4px sliver with its label clipped away. Two
    different selector strings, so the check said nothing.

    A scope makes a collision look deliberate, which is worse than an unscoped
    one. `.app .section` is the frame knowingly redefining a word it shares, and
    those are listed by name in the test; everything else sharing a final class
    name with an unscoped rule is an accident. The fix is a different word for a
    different thing, never more specificity.

    **On a phone a list is cards, not a table** (`.card-rows`). Each cell
    after the first carries `data-label`, the first becomes the card's title,
    and an `Actions` cell sits at its foot; `apps/web/test/admin-console.test.ts`
    holds the console to it. A console list that could not be read says so
    (`LoadFailed`), never "No workspaces yet" (rule 17).

54. **A screen says what a fault costs the person reading it, not the name of
    the vendor we buy from.** `/app/system` is gated on a session and nothing
    else, so the person reading it is normally the business owner whose
    campaigns are stuck. It told them to set `UNIPILE_WEBHOOK_SECRET`, pointed
    them at `/webhooks/unipile/messages`, named `REDIS_URL`, `RESEND_API_KEY`
    and `OPENAI_API_KEY`, and reported the account as "connected to Unipile" —
    our supply chain printed on somebody else's dashboard, and a repair
    assigned to a person with no access to perform it. That is rule 8 one step
    worse: repair that waits not for somebody to find a button, but for
    somebody who could never press it. `needsYou`'s webhook row did the same on
    the overview.

    So `Check` has two halves. `detail`, `fix` and `label` are the customer's:
    what is happening to their campaigns, what it costs them, and either
    something they can actually do or a plain statement that this one is ours.
    `operator` carries the vendor, the variable and the real remedy, and
    `/app/system` renders it only for a platform admin (`isPlatformAdmin`,
    which returns `false` on error — the privilege is the thing being asked
    about, so a failed check has to fall to the smaller answer).

    Moving it is the point; **deleting it is not**. Somebody still has to fix
    the deployment, and a row with no remedy anywhere is a worse screen than
    one with the remedy on the wrong half — so every blocked row carries an
    `operator` sentence, and every blocked row the customer can see carries
    either an action of their own or the way to tell us.

    `apps/worker/test/diagnostics.test.ts` walks every row in every state it
    has and greps the customer's half for a vendor name, a shouted environment
    variable and a path in this deployment, because the branch that regresses
    will be the one nobody re-read. The words are banned in code rather than in
    a review convention for the same reason `containsLink` exists: a prompt or
    a habit saying so is not what makes it true.

55. **An email to our own users is sent once, and marketing can always be
    stopped.** Every email to a user goes through `sendOnce`
    (`apps/worker/src/email.ts`), which claims `(user_id, step)` in
    `email_sends` (migration 0040) **before** it sends — the unique index is
    the whole never-twice guarantee, and a failed claim means do not send. A
    provider failure releases the claim so the next hourly run can retry.

    The onboarding sequence (`apps/worker/src/jobs/lifecycle.ts`) is keyed to
    what somebody has done, not to the calendar: each step has a moment it is
    due and a moment it goes stale, and is skipped if the thing it asks for is
    done. Stale steps are never sent late — that is also what stops a deploy
    mailing every existing user the whole sequence. Lifecycle and announcement
    mail honour `profiles.marketing_opt_out_at`, read immediately before the
    send; transactional mail (welcome, invitation, paused account, operator
    notifications) never does. A marketing email cannot be built without an
    unsubscribe URL, and a deployment that cannot sign one (no
    `INTERNAL_API_SECRET`) sends no marketing email at all. Announcements carry
    a second guard: `send_requested_at` is claimed in one statement, so a
    second press sends nothing. Copy names no vendor (rule 54); prices come
    from `lib/plans.ts` (rule 67). The trial reminder is transactional, so a
    marketing opt-out does not hide the day sending stops.

56. **Replies arrive by two doors, and every fault has a row in Issues.** The
    webhook is the fast path and it is configured on somebody else's dashboard,
    so `pollInbound` (`apps/worker/src/jobs/inbound-poll.ts`) asks the provider
    for new messages every fifteen minutes and once at boot, and queues them
    under the **same job id** the webhook uses — a reply arriving both ways is
    one job. `listNewMessages` existed for months and nothing called it, which
    is how a refused webhook meant a reply lost for good.

    `collectIssues` (`apps/worker/src/jobs/issues.ts`) is the operator's list
    of **system** faults — never what a member has not done yet. Worker, loop
    and nightly health; reply delivery and polling; accounts the provider
    stopped accepting or holds for nobody; background jobs failed past their
    retries; failing AI calls; campaigns running on an account that cannot
    send; email configuration. Rendered at `/admin/issues`, behind
    `platform_admins`, and it reads counts and statuses — never a message or a
    prospect (rule 15).

57. **Saving never signs anybody out.** Two separate faults did it, and each
    looked like the other. After a server action redirects, Next renders the
    target by fetching it over HTTP with the visitor's cookie; on Netlify the
    origin of that fetch is whichever host the instance *first* served, and an
    instance warmed by norasdr.com fetched from there, was bounced to
    app.norasdr.com by netlify.toml, and lost the cookie on the cross-host
    redirect. Every Save then rendered signed out and landed on /login while
    the browser still held a perfectly good session. `pinRequestOrigin`
    (called from `createClient`, which every action goes through) points that
    fetch at the host the request arrived on — only hosts this deployment
    serves, because the fetch carries the visitor's cookie. Route handlers
    answer with `seeOther(path)`, a relative 303, never a URL built from
    `request.url`.

    The second: a token refreshed during a page render cannot be written back,
    and refresh tokens are single-use, so an hour in, the session ended two
    clicks later. `middleware.ts` refreshes before the render and writes the
    cookies to both the request and the response. Neither fault is visible
    from the database — the sessions are intact — which is why they read as a
    customer who keeps forgetting to log in.

58. **A press is a request, not a job, and a quiet failure is still a failure.**
    The October audit walked one new customer from signup to a booked meeting
    through the code and found the same disease at a dozen stations: a step
    that did nothing and said so to nobody.

    *One run per request.* `/jobs/strategy` and `/jobs/targeting` go through
    `enqueueOnce` with a key per strategy (`strategyJobKey`, and
    `targeting--<profile>--<campaign|new>`): a customer pressed Build three
    times in eight seconds and got four near-identical campaigns over the same
    people. A press while a run is going answers `alreadyRunning`, and the
    screen says so. Reply and inbound jobs use `enqueueOnce` too (rule 44),
    because a finished job holding `reply:<draft>` swallowed the rep's Send.

    *The worker is the tenant boundary.* It holds the service role, so every
    id that arrived from a form is filtered by `workspace_id` — the targeting
    job used to run another company's strategy on another company's seat given
    the right UUID. An agent is read the same way (`agentById` takes the
    workspace), and the campaign forms check the agent and the CTA they post
    belong to the workspace before saving them.

    *Nothing waits on a moment that may not come.* A strategy approved before
    LinkedIn was connected is searched when the account connects and hourly
    after (`startPendingSearches`); a failed Strategy Agent run has a retry
    that does not go through `/onboarding`; the invite link is read through
    the worker by its token, because row-level security hides it from the
    signed-out person it was sent to.

    *The day is the rep's day.* Counters roll over at the rep's local midnight
    (`localDate`), and `daily_invite_cap` counts what the campaign sent today
    plus what is already queued, shared across campaigns on one account — a
    UTC reset sent a Pacific rep's whole allowance between five and six in the
    evening. Retries are jittered (`jitteredRetryMs`) so a released backlog
    never drains at the floor. A warmed invitation is placed inside its
    four-hour window, and a refused view is sent cold rather than re-warmed
    for ever.

    *A reply is never lost or misread.* Opt-outs are checked before any model
    call (rule 7); a reply the model could not read is held for a person; the
    poll keeps a read position per account; a booking acceptance must match an
    offered slot's day and minute exactly, is re-checked against the calendar
    before it is booked, and a refused insert books nothing.

59. **The console controls the product; it never speaks for a customer.**
    Every fix an operator made used to be SQL: pausing a campaign, clearing a
    LinkedIn hold, retrying a failed job, answering a ticket that had sat four
    days. `/admin` now does each of those through `runAdminControl`
    (`apps/worker/src/jobs/admin-control.ts`), which the worker performs after
    checking `platform_admins` itself. Two things are deliberately missing:
    **launching** a campaign (the owner's yes is the one gate with no way round
    it — the console resumes what its owner launched, never a draft) and
    **granting admin** through a control (rule 15: that is the Admins page,
    owners only).

    `platform_settings.outreach_paused_at` is the kill switch. It is read on
    the send path itself (rule 1) as well as in the pacing loop, because jobs
    already sitting delayed in the queue were placed before anybody pressed it.
    Waiting, never failing, and a settings row that cannot be **read** counts
    as paused: a database hiccup must not be what quietly turns it off.
    Customers are told sending is paused, never the operator's reason.

    Support is answered by an assistant (`answerSupportTicket`), and
    `supportGate` — pure, like `applyRules` — decides whether the customer sees
    the answer now or a person reads it first. The model's confidence is one
    input, never the verdict. Bugs, billing and feature requests, a ticket older
    than two days, a customer who pressed **Still stuck**, and any answer that
    names our suppliers or plumbing (rule 54) always wait for a person. A held
    answer is not lost: it is prefilled in the operator's reply box, so holding
    costs a minute and a wrong answer sent costs a customer. Every write is
    conditional on the ticket still being open, so the model never overwrites an
    operator who answered while it was thinking.

60. **Every search page is registered once, and the registry is the site
    map.** Guides, comparisons, tools and audience pages live in
    `apps/web/src/lib/seo-content.ts`: path, keyword-first title (60
    characters or fewer), description (155 or fewer), the one primary query
    it owns, owner teammate and related pages. The sitemap, the hubs, the
    footer's links, `llms.txt`, `feed.xml`, each article's "Read next" and its
    drawn feature image (`app/og/article`) all read from it, so a page missing
    from it is invisible to all of them at once. One query per URL:
    two pages chasing the same search split it and both lose.
    `node scripts/seo-check.mjs` checks titles, lengths, unique queries,
    broken internal links, inbound links, one H1 and dashes; run it after
    touching content. The keyword plan behind every page is in `docs/seo/`.

    Competitor facts on comparison pages are dated and sourced, and no
    sentence puts a price beside Nora's name (`team.test.ts`): a competitor's
    price is a fact about one month, and a price next to the product's name
    reads as the product's price. Teammate bylines name a part of the
    product, so structured-data authorship stays the organisation; a named
    human reviewer is the next step once one exists.

61. **The week is rolling, a refusal is a signal, and a send is claimed
    before it is made.** The October audit walked the sending engine with the
    random draws pinned at their extremes and the clock at every boundary, and
    each of these was a real account's problem, not a hypothetical.

    *The weekly cap is the last seven days, not the calendar week*
    (`invites_by_day`, migration 0042, maintained inside
    `record_linkedin_action` so rule 2 still holds). A Monday reset let a
    Wednesday launch send 170 invitations in seven consecutive days, and
    `docs/06-research.md` says LinkedIn counts a rolling window. Every screen
    reads the same function the loop does.

    *A day's placements end with the working day.* Invitations that do not fit
    before close are left for tomorrow's first tick rather than queued after
    hours, where they used to go out back to back at opening (rule 48's burst,
    moved to the morning). The wait after a profile view is drawn so the
    invitation can still be placed inside the warm-up window by the next tick
    (`apps/worker/src/warm.ts`) and inside today's hours; views are budgeted
    against the invitations still possible today across every campaign on the
    account. A view the invitation cannot follow is a view spent twice.

    *After a refusal, probe before spending.* While `invite_throttle_streak` is
    one or more, the account gets one cold invitation in flight and no views,
    and the next probe goes to somebody else. The first live account re-viewed
    the same five people six times each, once per expired hold, before one
    invitation was refused again. A person LinkedIn refuses twice as "invited
    recently" is closed with LinkedIn's reason instead of retried daily.

    *A send claims its row first* (`invite_claimed_at`, a ten-minute lease), and
    the caps are counted after the claim, so two presses of Send one now, or a
    press racing the loop, cannot invite one person twice or pass the cap at
    cap minus one. Send one now picks exactly whom the loop would.

    *The operator pause holds machine-written replies only.* A reply a person
    approved (`resolved_by`) still goes: a human answering a human is not
    outreach, as migration 0041 says. An autopilot reply waits.

62. **A free account's notes are LinkedIn's to ration, and running out is not
    a throttle.** LinkedIn lets a free (Basic) account attach a note to only a
    few invitations a month; its own help pages disagree between three and
    five, so `FREE_NOTES_PER_MONTH` is three. Past it LinkedIn refuses the
    whole invitation in exactly the words of a real throttle ("temporary
    provider limit"), and this product read it as one: every account that sent
    in October was held for six to seventy-two hours right after its third
    note, probed with the same note, refused, and held again.

    So the plan is modelled (`has_premium`, `has_sales_navigator`,
    `planOf`, migration 0045) and the note is decided on the send path
    (`noteAllowance`, rule 1): a free account's month is counted from what was
    actually sent with a note, and once it is spent the invitation goes without
    one, which LinkedIn allows. A refusal with a note on a free account is
    asked **once more without the note**: accepted, it was the note, and the
    month is marked spent (`notes_exhausted_month`); refused again, it is the
    account, and the throttle rules above apply unchanged. The note decides
    nothing else, so every cap, hold and check still runs.

    What LinkedIn reports is read from the provider (`getAccountPlan`, nightly
    and on the profile) and kept beside what the rep said, never over it, so a
    screen can say when they disagree. It decides `has_premium`, because a free
    account told it has Premium spends notes LinkedIn then refuses; it never
    flips Sales Navigator, because that changes the search and is the rep's
    switch. A lookup that could not look changes nothing (rule 17).

    A refusal reaches a person in words (`describeRefusal`, `plainReason`):
    notes used, invitation limit, one recipient, search limit, missing plan,
    sign-in, restriction, each with what happens next and when. The raw text
    names our supplier and a route (rule 54), and never reaches a customer
    screen.

63. **An account nobody uses is handed back, and the rep is told how to
    return.** Every connected account is billed by the provider each month,
    sending or not. `releaseIdleAccounts` (`apps/worker/src/jobs/idle-accounts.ts`,
    nightly) disconnects an account at the provider (`deleteAccount`) when it
    has no running campaign and **every** signal is older than
    `IDLE_RELEASE_DAYS` (14): connected, last send, a campaign created, edited
    or launched, a message in any of its conversations, and the rep's last
    sign-in or session refresh (`account_last_seen`, migration 0048 — a
    long-lived session never signs in again, so sign-in alone would release
    somebody working every day). `isIdleForRelease` is pure and is the rule.

    A lookup that failed is never "no activity": any read that errors releases
    nobody that night, and a rep the sign-in lookup did not answer for is kept
    (rule 17). Running campaigns are asked again immediately before the
    release, and the row is marked only while it still holds the id that was
    released, so a reconnect in between is never overwritten. A refusal leaves
    the row exactly as it was and is raised after every other account has had
    its turn.

    A released row is `disconnected` with `IDLE_RELEASE_DETAIL` and no provider
    id; `isIdleReleased` is the one reading of it. Every screen that would say
    "not connected" says `IDLE_RELEASE_TAGLINE` instead — the banner, the
    profile, the overview's list and Launch — because a rep who returns to a
    dead account with no reason reads it as the product breaking. Reconnecting
    is the ordinary Connect button. It is not a fault, so it never appears in
    Issues.

    **A duplicate is released the same way, and sooner.** Finishing the
    LinkedIn sign-in twice makes the provider create a second account that
    nothing here holds and the provider bills monthly. `releaseDuplicateAccounts`
    (`apps/worker/src/jobs/duplicate-accounts.ts`, at boot, nightly and after
    every claim) deletes a spare only when no row holds it, it carries the
    same person's label as a held account, that held account is healthy, and
    nobody with that label is part-way through connecting. A spare labelled
    with another person's user id is never anybody's twin, a spare with no
    reference at all is nobody's, and a display name never matches (rule 8).

64. **The day's pace is held at the moment of sending, not only when a job is
    placed.** Rule 48 spread a day's invitations when the loop placed them, and
    the send path only enforced the two-minute floor. But a job does not always
    go when it was placed: everything carried past close wakes at opening, and
    everything a lifted hold released wakes together. Held only by the floor, a
    backlog drained two to nine minutes apart — a two-day-old account sent five
    invitations between 09:13 and 09:27 on the morning after this rule was
    missing, the burst rule 48 exists to prevent, moved to the morning.

    So `runLinkedInAction` refuses an invitation sooner after the account's
    last invitation than `inviteFloorMs` (half a whole day's pace — about
    seventeen minutes at ten a day over eight hours, never under two), after
    the row is claimed, and counts another invitation claimed mid-send as one
    that has just gone, because two jobs waking together read the same last
    invitation. Refusals carry the ordinary jitter, so a held backlog finds its
    own places in the day. Half, not the loop's lowest jitter, so an ordinary
    placement that fires a minute late is never pushed past its warm-up window.

    The pace is **between invitations**: `lastInviteAt`
    (`apps/worker/src/pace.ts`) is the one reading, used by the loop and the
    send path both, and never `last_action_at`, which moves on every view. A
    view minutes before a warmed person's window closed made the gap look
    fresh, the invitation missed the window and the person was viewed twice.

    The loop holds the same floor whichever clamp moved a placement, and a
    warmed invitation is placed as soon as it is ripe and the floor allows —
    its timing is already the random wait drawn after the view. That wait now
    leaves a floor of room in the window for everybody already viewed and
    waiting (`warmUpWaitMs`'s reserve), and views are budgeted against the
    slowest the pace places invitations (`invitePaceCeilingMs`), not the
    average, which is rule 48's ceiling-in-the-divisor applied to views. A
    warmed person who still cannot keep the floor inside their window is left
    for a fresh view rather than squeezed in on the heels of the last.

65. **Setup is a sequence, and the app opens when the first campaign is
    live.** It was one long form and then a checklist on the dashboard, and the
    checklist was advice: a new customer could reach the app with no LinkedIn
    account, a call to action nobody chose and hours in the wrong zone, and
    wander into the agents page before a strategy was approved. Every one of
    those defaults reached a real prospect.

    `/onboarding` is now one screen per step (`WIZARD_STEPS` in
    `apps/web/src/lib/wizard.ts`): business, connect LinkedIn (with the plan),
    sending hours and timezone, voice, the call to action, approve a strategy,
    build the list, review and launch. Who answers replies is asked on the
    launch step, as two ways of working with nothing ticked — "I'll check each
    one" (`approval`) or "let Nora run it" (`autopilot`, autonomous) — through
    `setReplyHandling`, which sets the campaign being launched and, for the
    roles that may, the workspace. Autonomy and reply mode are set together
    everywhere (`setAutonomy`, `targeting.ts`): the reply gate holds every
    message on an `approval` campaign whatever its autonomy says, so an
    "on its own" answer that left the mode alone changed nothing. Launch itself
    never changes how replies are handled: a rep who chose "Hold for my
    approval" on the campaign page a second before pressing it keeps that. The business comes
    first because a LinkedIn account belongs to a workspace and the business
    step creates it — and it starts Sage, so the strategies are written while
    the person does the next four steps. Each step is decided from what is
    **stored**, never from which button was pressed (`readWizard`); the
    hours, voice and CTA have defaults, so a value being present proves
    nothing and a per-person confirmation stamp is the record that somebody
    looked. The current step is the first not done,
    in order (`currentStep`) — a LinkedIn account that drops sends somebody
    back to that step however far they got. Back is always allowed; forward
    past the current step is refused on the page and again in
    `/onboarding/save`, because a form can be posted by anyone and the last
    step launches.

    Until a workspace has a launched campaign the **middleware** sends every
    app page load to the current step (`gatesSetup`, `setupRedirect`), except
    Support and a campaign's own review page, which the last step links to —
    and that page's Launch only works from the last step. Not the layout: a
    layout is not rendered again when somebody clicks between the pages under
    it, so a check there could be walked past from the sidebar. Page loads
    only, never a POST, so the Sage retry posted from onboarding still runs. A
    lookup that fails lets the page through rather than sending somebody with
    live campaigns back to setup (rule 17), and the onboarding page shows a
    "could not load" notice instead of acting on facts it could not read. A
    launched campaign ends setup however it was reached, and is remembered in
    a cookie naming the user so a finished workspace makes no extra query.
    The provider's sign-in returns to the profile page; only that page's
    `connected` and `error` are carried to the LinkedIn step, which asks the
    provider rather than waiting to be told (rule 8). `?error=` carries a
    code mapped to words written on the page, never text from the address
    bar.

    Who may write what follows the database. The confirmation stamps live on
    the person's own profile row (`profiles.setup_confirmed`, migration 0049,
    keyed by workspace), because only owners and admins may update the
    workspace row and a teammate's stamp written there matched nothing and
    showed them the same step for ever. Every write a step depends on is
    checked by the rows it changed. Reply handling is set through
    `setAutonomy` (`lib/autonomy.ts`), the profile page's own path, by the
    same roles, onto every campaign as well as the workspace.

    The steps reuse the product's own paths rather than copies of them:
    `queueSearch` (`lib/search.ts`) for the search, `approveStrategy` for the
    approval, `launch` (`lib/launch.ts`) for the launch with every blocker
    re-checked and only on a draft, the competitor warning on the approval
    screen (rule 49). The CTA chosen is
    written onto every strategy that has no campaign yet and again onto the
    one approved, so the search writes its copy toward it (rule 29).

    **Every answer lands where the app reads it**, or the app asks for it
    again and the person reads setup as broken. Sage seeds the agent at the
    first step, so the voice step writes the name and description onto it too
    (`carryVoiceToAgent`, also from Profile; the bio line is one definition,
    `withRepBio`). The CTA step makes the entry Calls to action lists
    (`ensureCta`) and points strategies, and through `targeting.ts` their
    campaigns, at it; migration 0050 did the same for every workspace whose
    library was empty. The launch step shows the agent's seeded opener and
    offer and approves exactly those words on the press (matched on the body
    posted, rule 40). Screens that read the wrong thing were corrected rather
    than the data bent to them: spare strategies are options once one is
    approved (`needsYou`, the team panel, the overview), an agent on the
    deployment's model is "Automatic" rather than missing one, the pitch page
    counts an agent's approved lines, Availability falls back to the profile's
    timezone, How it works ignores optional steps, and the overview no longer
    asks the Sales Navigator question the LinkedIn step already asked.

    The hours step asks two questions, because they are two: when the
    account may send, and when prospects can book a call. The second is the
    `availability` row the slot finder reads (rule 6), written through
    `saveAvailability` (`lib/availability.ts`, shared with Meetings), and the
    step is not done until it exists — a rep who never saw it was booked into
    defaults they had not chosen. A running meeting campaign whose owner has
    neither saved hours nor their own scheduling link is a Needs you row.

    **From the strategy step on, setup can be put off.** "Launch later and
    open the app" stamps `deferred` on the person's own confirmations
    (`canDefer`, `defer` in `/onboarding/save`), the middleware lets them
    through, and Needs you carries one "Finish setup" row until something
    launches. A customer on Sales Navigator sat four days on "building your
    campaign" because every search was refused and the only way out was a
    launch the search had made impossible. The list step offers every approved
    strategy with no campaign, each with its own search and its own last stop
    (kept however old it is); a draft counts as a list only once somebody is
    on it; a launch's blockers are checked before anything is written; and no
    wait polls for ever.

    The approval step always has a way out. "None of these fit?" takes who
    the owner actually sells to, in their words, and runs Sage again with it
    (`guidance` on `StrategyJob`); the rejected suggestions are set aside only
    once the new ones are stored, and never an approved one or one with a
    campaign. Without it an owner whose suggestions were all wrong could
    approve a segment they knew was wrong or stop, and one did stop.

    Launching ends on `/app?tour=1`: a ten-stop tour of the real pages
    (`WALKTHROUGH`, `components/walkthrough.tsx`), driven by `?tour=N` so each
    stop is an ordinary page load, never modal, startable again from How it
    works. The link preview (`BRAND.promise`, the home page title) says what
    the product does — finds buyers, writes each a note, answers, books —
    rather than one of its guardrails.

66. **The agent writes like a person texting one person, and code checks it.**
    What reached prospects read as a model: a raw `{{company}}`, a first
    message introducing "our Revenue Capture System", and a reply to somebody
    who had just said they were not ready that mirrored their words, dashed,
    listed three features and sent the booking link. Every writer had its own
    rules, none mentioned a dash, and several prompts' own examples used one.

    `VOICE_RULES` (`packages/shared/src/voice.ts`) is the one definition and
    every writer's prompt carries it: replies, campaigns, invite notes,
    openers, offers, strategies. The prompt is never trusted (`callStructured`
    casts), so `voiceProblems` checks every message in code — length per kind
    (`MESSAGE_MAX_CHARS`, links excluded), dashes, semicolons, stock openers,
    the banned phrases, feature runs, quoted titles, sign-offs, unfilled
    placeholders, and a reply that reads their own words back. A message with
    problems is rewritten **once**, handed the exact list. `tidyVoice` makes
    only edits that cannot change meaning, and nothing is ever truncated.

    **Nothing is offered that cannot be sent.** "Want a two sentence example?"
    and "can I send a quick checklist?" promised things no knowledge document
    held, so a yes could not be answered. `offeredAsset` flags an offered
    example, checklist, guide, template, audit or case study unless a
    knowledge title, the CTA label or its URL path names it (a link's host
    never counts), and the writers are told what exists to send.

    What still fails is never sent quietly: a reply is held for a person, a
    personal note is left out so the angle's reviewed note goes instead, a
    campaign records `campaign.voice_problems` for its reviewer, and a
    follow-up carrying any unfilled `{{…}}` at send time is held as copy with
    its schedule untouched (`HELD_FOR_COPY`).

    **What a reply may do is decided by what they said** (`replyMove`,
    `packages/shared/src/reply-playbook.ts`), in code. Interested: the offer
    and the next step. A question: an answer, and a link or times only if
    they asked. Not ready, an objection, a referral: no pitch, no link, no
    times. Somebody who already has the link is not sent it again. An
    auto-reply or spam is not answered. The worker takes the link and the
    times away when the move forbids them, so a draft that sends one anyway is
    held by the link check (rule 30) rather than trusted.

    **Stored copy is repaired, not grandfathered.** Fixing the writers changed
    nothing anybody would receive that week: the old copy was in the database
    and went out as stored — `{{company}}` in step 1 of most running
    campaigns, three of every five queued notes failing. `repairCopy`
    (`apps/worker/src/jobs/repair-copy.ts`, at boot and nightly) rewrites only
    what fails, through `reviseForVoice`, on draft, running and paused
    campaigns. A revision that drops `{{cta_link}}` or `{{pitch}}` or adds a
    link is refused. Every write is conditional on the text still being what
    was read, so a person's edit wins. Only `queued` notes change, because a
    sent note is a record. A personal note nobody could fix is cleared so the
    campaign's own note goes instead. Approved pitches and openers are not
    rewritten: an approval is a statement about particular text (rule 40).

    **The words win over a warm misreading.** "When I can convince the owner
    we can start looking at systems" was classified `interested` at 0.86, so
    a playbook keyed on intent alone would still have pitched her.
    `effectiveIntent` reads a plain not-yet as `not_now` and "we already have
    one" as `objection` unless they asked for the next step themselves,
    checked in code as opt-outs are (rule 7), and the classifier is now told
    what each intent means. A first message whose question is homework
    ("how do you currently…", a fourteen-word "how are X passed to…") and a
    step that is only `{{pitch}}` both fail the check.

    The seed cut the one-liner at ninety characters ("We produce and
    distribute short.") and opened every account with "Sam here regarding
    Lee Plumbing." The offer and opener are now written by `writePitch` and
    `writeHooks` at seeding, and `repairSeededLines` replaces rows still
    holding the old seeded text, unapproved and agent-written only.

    **The first message is written for the person who accepted.** Step 1 was
    one template for everybody, so every acceptance read the same sentence.
    `writeFirstMessages` (`apps/worker/src/jobs/first-message.ts`) runs in the
    acceptance poll, never on the send path, and stores
    `campaign_prospects.first_message` (migration 0051) from their own
    details, the note they accepted and the angle. It never names the product
    or the company, carries no link and is voice-checked; anything it cannot
    write cleanly is left null and step 1 goes as the campaign wrote it.

67. **Two plans separated by what Nora does on its own, never by what it
    sends.** Nora Pro ($99 a month, $990 a year) and Nora Autopilot ($179, $1,790)
    are said once, in `apps/web/src/lib/plans.ts`; the pricing page and the
    plan cards read it, and `team.test.ts` refuses a dollar figure typed
    anywhere public. Both plans get the same caps (rule 4). Pro holds every
    reply for a person, holds pricing questions, confirms each booking by hand
    and syncs no CRM (`TIER_FEATURES`, `rulesForPlan` in
    `apps/worker/src/billing.ts`, narrowing only and before `applyRules`, which
    stays pure, rule 5).

    Every workspace from before pricing is on the `free` plan (migration 0052)
    and keeps every feature for good: no clock, no plan screen, no email. A new
    workspace gets fourteen days of Autopilot with no card; a reminder goes on
    day twelve through `sendOnce`, and on day fifteen sending waits until a
    plan is chosen. The plan is read on the send path as well as in the pacing
    loop (rule 1), and an unreadable plan waits rather than sends. Choosing a
    plan during the trial keeps the trial: Stripe's first charge is its end.

    The trial's end pauses nobody until payments are switched on: the worker
    enforces it only with Stripe's keys and all four prices set
    (`trialEnforced`), and states that in its boot heartbeat so the web never
    announces a stop the worker is not making. The billing columns are written
    by the service role only (a trigger in migration 0052; RLS cannot restrict
    columns). On Pro a confirmed time is written as a `meetings` row, so the
    slot is never offered twice (rule 18).

    Stripe events are applied newest-wins (`last_billing_event_at`), only for
    the subscription the workspace holds, and recorded only after they apply,
    so a failed write is retried rather than answered as a duplicate. A price
    whose lookup key is not one of `PRICE_KEYS` leaves the plan alone rather
    than reading as a trial, which would stop a paying workspace.

68. **Nora likes and comments on prospects' posts, and every one is earned.**
    `planEngagement` (`apps/worker/src/jobs/engagement.ts`, hourly) picks, for
    each working account inside its owner's hours, people in its running
    campaigns who are still in a live conversation, none engaged with in the
    last week, and one recent post of their own each (`choosePost`: no
    reposts, nothing older than three weeks, nothing about grief, illness, a
    lost job or politics). A like, and a comment when the post says enough to
    respond to. Each is an `engagement_actions` row (migration 0053; the unique
    index means one like and one comment per post, ever) and a job on the one
    send path (rule 1), which re-checks do-not-contact, the exclusion list, an
    ended conversation, the pause, the plan and the limiter at the moment of
    sending.

    **Each activity has its own switch**, on one page (Profile → LinkedIn
    activity): likes (`engage_posts`), comments (`engage_comments`) and
    publishing approved posts (`publish_posts`, migration 0058), plus profile
    views before inviting, which new campaigns take from the workspace. Each
    is read again on the send path. A workspace that had turned the old shared
    switch off keeps comments off.

    Likes and comments have their own allowances (25 and 5 a day, 2 a day in an
    account's first fortnight), counted in the same statement as every other
    action (rule 2), and neither starts the invitation ramp (rule 3). A day's
    allowance spent means skipped, never carried into tomorrow onto an older
    post. Nothing is planned while LinkedIn is holding the account's
    invitations.

    LinkedIn's 2026 policy targets automated comments, so a comment is the
    action held tightest: written at planning time, never on the send path, it
    must name a phrase the post really contains (`grounding`), pass the voice
    checks, praise nothing in general, carry no link or bare domain, never name
    the company and never ask for a call (`commentProblems`). One rewrite; a
    comment that still fails is not written and the post is only liked.

    **A comment reacts; it never sells.** The first live week named no product
    and still read as outreach: every comment was a probing question about the
    poster's tools, metrics or process, a discovery call held in public,
    because the writer was told what the rep sells "for context". It is no
    longer told. A comment asks nothing and never talks about what we do
    (`commentPitchProblems`: a `?`, "we help", "our clients", "happy to
    help"), checked again on a queued comment immediately before it posts so
    copy from an older prompt is held to the same line. Job openings and
    adverts are liked and never commented on (`sellingPost`). Congratulating
    somebody on news they shared is allowed; a stock line on its own is not.
    Comments are 2 a day in an account's first 14 days of sending, then 5, and
    the screens say so beside the meter. Every
    like and comment, with the words of the post and of the comment, is listed
    on `/app/engagement`, where an owner or admin can turn it off.

    The row is **claimed** (`sending`) immediately before the provider call and
    marked `sent` before it is counted, so a retried job never posts a comment
    twice. A like that wakes more than three hours late, on a post now past
    three weeks, or for a campaign no longer running is skipped, never sent: a
    lifted pause must not become a burst. A refusal marks the account's health
    as every send does, and the screen gets words while the provider's text
    goes to an event (rule 54). A person's posts are read at most once in three
    days (`posts_checked_at`), so the planner moves down the list instead of
    reading the same six people hourly. Nothing is planned while outreach is
    paused, nothing past today's close, and planning runs last in the hourly
    chain so it never delays account repair. Erasing a prospect deletes their
    rows here too.

69. **A post is useful to its reader, never an advert, and its picture shows
    what it says.** Posts are organic content for the industries the approved
    strategies reach: a how-to, a myth corrected, a checklist, an insight, a
    story, and this week's news in that industry (`format`, migration 0061). A
    profile full of posts about the business is what a prospect checking the
    sender after an invitation reads as a sales account. `postProblems`
    (`packages/shared/src/posts.ts`) drops a draft that pitches ("we help", "our
    clients", book a call, DM me, link in the comments), carries an emoji or a
    dash, because `callStructured` casts and the prompt is not what makes it
    true.

    **The week's news is real or absent.** `industryNews`
    (`apps/worker/src/news.ts`) reads headlines from the last seven days for
    the audience's industries; the writer gets the headline, the publication
    and the date, and an `industry_update` written with none supplied is
    dropped. A failed read means no update post that week, never an invented
    one. `writeWeeklyPosts` (nightly) writes each rep with an active account a
    fresh set once their newest post is six days old, never over a draft
    somebody edited, only for a workspace that can send and publishes posts.
    Nothing is published by it: the drafts wait for approval, and Needs you
    says they are there.

    **The picture is the post's content, drawn.** The writer describes it as
    structure (`PostVisual`, `packages/shared/src/post-visual.ts`): numbered
    steps, two sides compared, one number, a checklist, a chain of cause and
    effect, or the key line framed. `visualProblems` holds every line to the
    post: no number the post does not state, no dash, emoji, hashtag, link or
    placeholder, and the shape each kind needs. A visual that fails becomes the
    post's own short first sentence framed, or no picture. Drawn, never
    generated (`drawPostGraphic`, `apps/web/src/lib/post-graphic.tsx`): an image
    model invents text and faces on a real professional's profile. Portrait 4:5,
    in the company's colours (`graphicPalette`, every text colour picked by
    contrast), with no name of the rep's on it. `graphic_headline` is the
    picture's title and `graphic_spec` the rest; a row from before structure is
    drawn as its headline framed (`readVisual`).

    **What is approved is what goes out.** Approval checks the picture against
    the post, draws it, stores the PNG (`linkedin_post_graphics`), then approves
    only if the row's `updated_at` is still the one it was drawn from; changing
    the words, the picture or its style clears the approval in the trigger, as
    rule 40. The publish sweep attaches the stored picture, scoped to the
    workspace, and holds the post rather than sending it bare when the picture
    cannot be read. Brand colours are read from the website when Sage reads it
    (`detectBrandColors`, only filling colours nobody set) and editable on
    Profile → Company.

## Conventions

- Agent output is validated against a zod schema before it touches the
  database. Model-facing schemas use `.nullable()` rather than `.optional()`:
  structured outputs reject optional keys.
- Every sent message records the `prompt_version` that produced it, so a
  regression traces back to the change that caused it. Bump the version
  constant when you edit a prompt. A follow-up records the version stored on
  its own step (`campaign_steps.prompt_version`, migration 0059), never the
  build's current one: the writer stamps it, the nightly repair stamps its
  revision, and a person's edit clears it.
- `launched_at` is the first launch and is stamped once (`.is("launched_at",
  null)`), before the status and checked, so a campaign is never running with
  no launch on record; a resume sets the status only. A resume is never
  refused for an empty invitation queue (`resuming` on `LaunchState`): the
  people who accepted are still mid-sequence and only a running campaign
  sends their follow-ups.
- A read of `workspaces.onboarding` that failed is never merged into: that
  column holds every setup answer, and a write of one key over a failed read
  replaces all of them. On setup's CTA step only a scheduling service's page
  typed in the general link box becomes the rep's booking link (rule 31).
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

`apps/worker/test/value-flow.test.ts` runs the whole journey — setup answers,
Sage, approval, search, notes, launch, sends, acceptance, follow-ups, a reply,
booking, likes and comments — through the real job functions with a fake model
that records every prompt, and asserts each answer lands where it is used.
Unit tests pass while a value is dropped between two stages; this suite is
what catches it. When a stage starts reading a new setting, add the
assertion here.

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

- Acceptance is detected by polling connections every hour
  (`apps/worker/src/jobs/acceptance.ts`, paged), so the first message lands
  20 to 90 minutes after the poll notices, usually within a couple of hours of
  the acceptance. Unipile exposes no acceptance webhook; if one appears, that
  is where to use it.

- The email follow-up channel for prospects who accept an invitation then go
  quiet. Roadmap item for quarter two; the email layer it would need already
  exists in `packages/email`.
- The Solo plan's no-Sales-Navigator path in `docs/02-product-spec.md` should
  not be built as written. LinkedIn sued Proxycurl and it shut down in July
  2025; see `docs/06-research.md`.
