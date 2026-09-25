/**
 * Safety caps for LinkedIn actions. These are product rules, not tunables:
 * see docs/02-product-spec.md section 4. Per-account overrides may only go lower.
 *
 * Numbers follow the vendor consensus recorded in docs/06-research.md section 2:
 * LinkedIn's weekly invitation ceiling is unpublished and adaptive, observed at
 * roughly 100/week, so we sit under it rather than at it. Unipile applies no
 * limits of its own and simply passes LinkedIn's through, which makes this file
 * the only thing standing between a campaign and a restricted account.
 */
export const LINKEDIN_LIMITS = {
  /** Connection requests per day on day 1 of a new account. */
  invitesPerDayStart: 10,
  /** Connection requests per day after the warm-up ramp. */
  invitesPerDayMax: 35,
  /** Days over which invitesPerDayStart ramps to invitesPerDayMax. */
  warmupDays: 35,
  /** Hard weekly ceiling for connection requests, all campaigns combined. */
  invitesPerWeek: 100,
  /** Messages per day (follow-ups + replies). */
  messagesPerDay: 50,
  /**
   * Profile views per day, as a warm-up before the invitation.
   *
   * Deliberately below the field consensus rather than at it. Practitioners
   * report 80 to 150 a day without trouble and some tools will do 500; the
   * conservative end of the published guidance is under 50, and that is the
   * end this product sits at — a view is the cheapest action on LinkedIn and
   * the easiest to do far too many of, and the whole promise here is that we
   * stay well under the line rather than finding it.
   *
   * It is its own allowance, counted separately from invitations. A view is
   * not a connection request: it costs nothing from the capped daily invite
   * ramp, it is not refused when LinkedIn throttles invitations, and spending
   * one from the invite budget would mean warming a prospect cost us the
   * ability to write to them.
   */
  profileViewsPerDay: 40,
  /** Minimum gap between two actions on one account, milliseconds. */
  minGapMs: 2 * 60_000,
  /** Maximum gap added as random jitter, milliseconds. */
  maxGapMs: 9 * 60_000,
  /**
   * The soonest a follow-up may go out after somebody accepts, and the widest
   * that wait may be.
   *
   * Zero is wrong in both directions. A message landing in the same second as
   * the acceptance is a robot announcing itself, and it is the pattern
   * LinkedIn's own heuristics watch for. A message three days later is a
   * stranger who has forgotten accepting. Twenty to ninety minutes is a person
   * who noticed and got round to it.
   *
   * The working-hours check still applies on top: somebody accepting at three
   * in the morning is written to in the morning, not at 03:20.
   */
  acceptFollowUpMinMs: 20 * 60_000,
  acceptFollowUpMaxMs: 90 * 60_000,
  /**
   * How long after looking at somebody's profile the invitation goes out.
   *
   * The point of the warm-up is that the request arrives to a name they have
   * already seen, so the view has to land *before* it and far enough before
   * that the two do not read as one automated burst. A view and an invitation
   * in the same minute is a robot announcing itself; a view four hours earlier
   * is a person who looked somebody up, thought about it, and got round to
   * reaching out.
   *
   * Still inside working hours, and still behind the ordinary gap between two
   * actions — this is the earliest the invitation may go, not a promise that
   * it goes then.
   */
  warmUpToInviteMinMs: 45 * 60_000,
  warmUpToInviteMaxMs: 4 * 60 * 60_000,
  /**
   * Withdraw pending invites older than this many days. LinkedIn permits one
   * withdrawal pass per week and only on invites at least 14 days old, so the
   * sweep runs weekly and this threshold stays above that floor.
   */
  withdrawAfterDays: 21,
  /**
   * Acceptance rate below which an account is flagged for review by the
   * nightly sweep. Low acceptance is the signal LinkedIn itself watches.
   */
  minHealthyAcceptanceRate: 0.3,
} as const;

/**
 * The first message after somebody accepts is not on a schedule anybody sets.
 *
 * A campaign's steps each wait `delay_days` before sending, measured from the
 * message before them — which works for step 2 onward and is meaningless for
 * step 1, because there is no message before it. What comes before step 1 is
 * the acceptance, and the acceptance is the event the whole campaign was built
 * to produce.
 *
 * Left configurable, the Targeting Agent wrote `3` into step 1 of every
 * campaign this deployment has ever built. So a stranger accepted a connection
 * request, heard nothing for three days, and then received an opener about a
 * conversation they had forgotten starting. Three accepted invitations sat in
 * exactly that state while the funnel reported no messages sent and no replies,
 * which reads from every screen as an agent doing nothing.
 *
 * It is a product rule for the same reason the caps are: it is the difference
 * between an outreach that works and one that quietly does not, and it is not
 * improved by anyone turning it up. `acceptFollowUpMinMs`/`MaxMs` already say
 * what the window is — twenty to ninety minutes, jittered, with the
 * working-hours check on top. This is the sentence that says step 1 may not
 * opt out of it.
 *
 * Steps 2 and beyond keep their configured delays in full: those are measured
 * from a message that really was sent, and a rep pacing their own follow-ups is
 * exactly the judgement this product should take from them.
 */
export const FIRST_STEP_DELAY_DAYS = 0;

/** What the screens say step 1 waits for, so no screen invents its own wording. */
export const FIRST_STEP_TIMING_LABEL = "as soon as they accept";

/**
 * The name the pacing loop stamps its heartbeat under.
 *
 * One string, because the loop writes it and three screens read it, and a
 * heartbeat filed under a name nobody queries is a heartbeat that does not
 * exist.
 */
export const PACING_LOOP = "campaign-tick";

/**
 * Two more stamps the pacing loop writes, because one row cannot answer the
 * question anybody actually has.
 *
 * `worker_heartbeats` keeps one row per name, upserted — the right shape for
 * "is the loop alive", and useless for "what did it do today". The loop runs
 * every five minutes and declines most of them correctly, so by the evening the
 * single row says `outside_working_hours` and nothing else, whatever happened
 * at eleven in the morning. A run that threw at two o'clock is erased by the
 * healthy decline at five past. That is not a hypothetical: a full working day
 * went by with seven prospects queued and nothing sent, and the only record of
 * why had already been overwritten by a run that correctly did nothing.
 *
 * A quiet run never writes either of these, which is the whole point. The last
 * run that did something and the last run that broke both survive every quiet
 * run after them, so the two questions worth asking — "when did it last send
 * anything" and "when did it last fail, and how" — have answers on the screen
 * rather than in a log on a host the person asking cannot reach.
 */
export const PACING_LAST_ACTION = "campaign-tick:last-action";
export const PACING_LAST_FAILURE = "campaign-tick:last-failure";

/**
 * The name the worker stamps the moment it starts.
 *
 * Written straight to Postgres, before and regardless of the queue, because it
 * is the one signal that separates the failures the pacing heartbeat cannot
 * tell apart: a process that is not running, a process that is running but
 * cannot reach its queue, and a deployment still serving the previous build.
 * Those are three different things to do about it and the pacing stamp reports
 * all three as the same absence -- it can only be written by a loop that needs
 * the queue in order to run at all.
 */
export const BOOT_BEAT = "worker-boot";

/**
 * How long the pacing loop may go unheard before a screen says so.
 *
 * It wakes every five minutes; three missed wake-ups is a gap no amount of
 * normal jitter explains, and short enough that somebody watching a launch
 * finds out during the launch.
 */
export const PACING_STALE_MS = 15 * 60_000;

/**
 * The name nightly maintenance stamps when it finishes a run.
 *
 * Maintenance is where the promises this product makes outside a campaign are
 * actually kept: data erased at the retention limit, invitations withdrawn
 * before they sour an account's acceptance rate, approved replies that were
 * never dispatched picked back up, accounts repaired. All of it at 3am, none of
 * it on a screen. A month of it not running looks exactly like a month of it
 * running and finding nothing to do.
 */
export const MAINTENANCE_BEAT = "maintenance";

/**
 * The name the inbound message webhook stamps on every delivery it refuses.
 *
 * Failing closed is right — a forged delivery writes a stranger's words into a
 * rep's inbox — but the refusal was said to nobody. Unipile called this
 * deployment carrying no signature header at all, the worker answered 401 as it
 * should, and the only trace was this row, which no screen read. A real
 * conversation was live on LinkedIn and absent from the product's own inbox,
 * with the product reporting a healthy webhook because the *secret* was
 * configured: a check passing because it could not look (rule 17).
 */
export const MESSAGE_WEBHOOK_BEAT = "webhook:messages";

/**
 * How long maintenance may go unheard before a screen says so.
 *
 * It runs once a night, so two missed nights is the first gap that cannot be a
 * late start or a restart during the run.
 */
export const MAINTENANCE_STALE_MS = 50 * 60 * 60 * 1000;

export const DEFAULT_WORKING_HOURS = { start: 8, end: 18, days: [1, 2, 3, 4, 5] } as const;

/** Phrases that end a sequence immediately. Matched case-insensitively as substrings. */
export const OPT_OUT_PHRASES = [
  "not interested",
  "stop messaging",
  "stop contacting",
  "remove me",
  "unsubscribe",
  "do not contact",
  "don't contact",
  "leave me alone",
] as const;

/**
 * The two model roles this product uses, per provider.
 *
 * `writer` is customer-visible prose — profiles, campaign copy, reply drafts —
 * where a clumsy sentence is what a prospect judges the sender by. `classifier`
 * is high-volume triage, where the job is a label and the deciding factor is
 * cost per thousand.
 *
 * Which provider answers is a deployment choice (`createLlmClient` in
 * @le/agents, decided by whichever API key is present). Both rows live here so
 * MODEL_PRICING can be checked against every model the product can call — an
 * unpriced model reports its spend as unknown forever.
 */
export const MODELS = {
  // Both roles on gpt-5-mini by choice, not by default: gpt-5's output costs
  // five times as much, and the first campaigns run in approval mode where a
  // human reads every draft before it sends. That review is the quality gate
  // the eval cannot be — it scores the classifier, never the prose. If drafts
  // start reading like a template, `writer` is the one word to change.
  openai: { writer: "gpt-5-mini", classifier: "gpt-5-mini" },
  anthropic: { writer: "claude-opus-5", classifier: "claude-haiku-4-5" },
} as const;

export type LlmProvider = keyof typeof MODELS;

/**
 * The most characters LinkedIn accepts in a connection request note.
 *
 * 200, not 300. 300 is the Premium number, and it was written into the prompt,
 * the schema, the second check in `personalizeInvites` and the comment above
 * that check — four places agreeing with each other and with LinkedIn's
 * documentation for an account this deployment does not have. A free account
 * gets 200, and LinkedIn does not truncate what is over it, it refuses the
 * whole invitation:
 *
 *   400: Too many characters — The provided content exceeds the character
 *   limit. — errors/too_many_characters
 *
 * Which is a live campaign's first send failing against a real person, on a
 * list somebody reviewed, for a reason no screen could explain. Sixteen of the
 * first twenty-three notes written here were between 200 and 278 characters:
 * inside the cap that was wrong, outside the one that is real.
 *
 * Deliberately not per-account. Detecting Premium reliably is a request we
 * would have to make and trust, and being wrong costs a refused invitation off
 * a capped daily allowance. 200 is the number that works for every account,
 * and a Premium account losing 100 characters it could have used is not a
 * failure anybody sees.
 */
export const INVITE_NOTE_MAX_CHARS = 200;

/**
 * How long a pitch may be.
 *
 * A pitch is spoken into a chat window, not read on a landing page. Ninety
 * characters is what somebody actually takes in on a phone two seconds after
 * asking "what is this?" — one line, one idea. A paragraph there is skimmed and
 * then ignored, and a skimmed pitch looks exactly like one that was never sent.
 *
 * It is a hard limit rather than guidance for the same reason the invite note's
 * is: the model will happily write 400 characters of excellent prose, and the
 * only place that gets noticed is in front of a prospect.
 */
export const PITCH_MAX_CHARS = 90;

/** How many the agent writes in one go: enough to compare, few enough to read. */
export const PITCH_VARIANTS_MIN = 4;
export const PITCH_VARIANTS_MAX = 5;

/**
 * How long an opener may be.
 *
 * It is the shape of a connection note, and LinkedIn refuses the whole
 * invitation at 200 characters (`INVITE_NOTE_MAX_CHARS`). A hundred and twenty
 * leaves the writer room to say the one specific thing about the person that
 * makes the note theirs rather than a template — which is the entire job of
 * rule 16. An opener that fills the note leaves nothing for the person it is
 * addressed to.
 */
export const HOOK_MAX_CHARS = 120;

/** Same as the pitch: enough to compare, few enough to read in one sitting. */
export const HOOK_VARIANTS_MIN = 4;
export const HOOK_VARIANTS_MAX = 5;
