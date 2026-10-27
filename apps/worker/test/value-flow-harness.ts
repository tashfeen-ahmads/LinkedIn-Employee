import { vi } from "vitest";
import { MockLinkedInProvider, type ProviderPost } from "@le/linkedin";
import { CTA_DEFINITIONS, withRepBio, type ProspectCandidate } from "@le/shared";
import type { LlmClient, LlmRequest, LlmResponse } from "@le/agents";
import { FakeDb } from "./fake-db.js";
import { runStrategyJob } from "../src/jobs/strategy.js";
import { runTargetingJob } from "../src/jobs/targeting.js";
import { jobDueAt, runCampaignTick } from "../src/jobs/campaign-tick.js";
import { RescheduleError, runLinkedInAction } from "../src/jobs/linkedin-action.js";
import type { WorkerContext } from "../src/context.js";
import type { LinkedInActionJob, Queues } from "../src/queues.js";

/*
 * The value-flow harness: one workspace, set up the way onboarding leaves it,
 * driven through the worker's real job functions in the order a customer
 * meets them.
 *
 * Three fakes and nothing else:
 *
 * - `ValueFlowDb`, the repo's FakeDb with the column defaults the migrations
 *   declare. The real database fills `campaign_prospects.last_step_sent = 0`
 *   and friends on insert; the plain fake leaves them `undefined`, and the
 *   pacing loop then computes `undefined + 1`. A defaults table is the
 *   faithful fix, not a stub: every value below is quoted from a migration.
 * - `RecordingLlm`, an `LlmClient` that records every request it receives and
 *   answers with schema-valid canned output. It is deliberately a *literal*
 *   model: where a prompt gives an explicit instruction ("Name it as X", "The
 *   ONLY link you may send is Y", "Times you may offer: ..."), it does exactly
 *   that, so what reaches a prospect is what the prompt asked for.
 * - `MockLinkedInProvider`, unchanged, plus a queue that keeps what it is given
 *   and is drained the way the worker drains it.
 *
 * The onboarding steps are mirrored from apps/web (they import "server-only"
 * and "@/" aliases, so they cannot be loaded here). Each one writes exactly
 * the rows the route writes, and names the line it mirrors.
 */

export const WORKSPACE = "aaaaaaaa-0000-4000-8000-000000000001";
export const USER = "aaaaaaaa-0000-4000-8000-000000000002";
export const ACCOUNT_PROVIDER_ID = "acct_sam";
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

/* ------------------------------------------------------------ the database */

type Row = Record<string, unknown>;

/** Column defaults, as the migrations declare them (file named beside each). */
const DEFAULTS: Record<string, Row> = {
  // 0001, 0042 (invite_refusals), 0011 (invite_note_*)
  campaign_prospects: {
    status: "queued",
    last_step_sent: 0,
    invite_refusals: 0,
    invite_note_grounding: [],
    invite_note_thin: false,
    invite_note_edited: false,
  },
  // 0001
  prospects: { fit_reasons: [], signals: [], do_not_contact: false },
  // 0001, 0014, 0019, 0033
  campaigns: { status: "draft", daily_invite_cap: 20, search_exhausted: false, cta_kind: "meeting", warm_up: false },
  // 0001, 0019
  customer_profiles: { priority: 3, do_not_pursue: false, cta_kind: "meeting" },
  // 0001, 0032, 0033, 0042, 0045, 0053
  linkedin_accounts: {
    provider: "unipile",
    status: "connecting",
    has_sales_navigator: false,
    has_premium: false,
    invites_today: 0,
    invites_this_week: 0,
    messages_today: 0,
    profile_views_today: 0,
    reactions_today: 0,
    comments_today: 0,
    invite_throttle_streak: 0,
    invites_by_day: {},
    working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    first_action_at: null,
    last_action_at: null,
    invites_paused_until: null,
    invites_paused_reason: null,
  },
  // 0027, 0028
  pitches: { name: "Pitch", is_default: false },
  hooks: { is_default: false, written_by: "agent" },
  // 0002, 0053
  workspaces: { seats: 1, engage_posts: true },
  // 0049
  profiles: { setup_confirmed: {} },
  // 0012
  meetings: { booked_via: "agent" },
  // 0053
  engagement_actions: { status: "queued" },
};

function withDefaults(table: string, payload: Row | Row[]): Row | Row[] {
  const defaults = DEFAULTS[table];
  if (!defaults) return payload;
  const fill = (row: Row) => ({ ...defaults, ...row });
  return Array.isArray(payload) ? payload.map(fill) : fill(payload);
}

/** Upserts that only ever create here (ON CONFLICT DO NOTHING), so defaults are safe to apply. */
const UPSERT_DEFAULTS = new Set(["prospects", "campaign_prospects"]);

export class ValueFlowDb extends FakeDb {
  override seed(table: string, rows: Row[]): void {
    super.seed(table, withDefaults(table, rows) as Row[]);
  }

  override from(table: string) {
    const qb = super.from(table);
    const insert = qb.insert.bind(qb);
    const upsert = qb.upsert.bind(qb);
    qb.insert = (payload: Row | Row[]) => insert(withDefaults(table, payload));
    qb.upsert = (payload: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) =>
      upsert(UPSERT_DEFAULTS.has(table) ? withDefaults(table, payload) : payload, options);
    return qb;
  }
}

/* ------------------------------------------------------------ the model */

export interface RecordedCall {
  agent: string;
  model: string;
  system: string;
  user: string;
}

export interface Classification {
  intent: string;
  sentiment: "positive" | "neutral" | "negative";
  needsHuman: boolean;
  needsHumanReason: string | null;
  mentionsPricing: boolean;
  mentionsLegalOrCompliance: boolean;
  asksForHuman: boolean;
  optOut: boolean;
  referralName: string | null;
  followUpAfterDays: number | null;
  confidence: number;
}

export function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    intent: "interested",
    sentiment: "positive",
    needsHuman: false,
    needsHumanReason: null,
    mentionsPricing: false,
    mentionsLegalOrCompliance: false,
    asksForHuman: false,
    optOut: false,
    referralName: null,
    followUpAfterDays: null,
    confidence: 0.95,
    ...overrides,
  };
}

/** The three strategies Sage "writes" for the business described at signup. */
export const STRATEGIES = [
  {
    name: "Agency owners",
    summary: "Owners of 10 to 50 person marketing agencies who live on referrals.",
    jobTitles: ["Founder", "Managing Director"],
    seniority: ["Owner"],
    industries: ["Marketing Services"],
    companySize: "11-50",
    geography: ["United States"],
    triggerEvents: ["Hired a first account manager"],
    pains: ["Agency referrals sit in an inbox for a week before anyone replies"],
    valueProposition: "Every referral answered within the hour.",
    whatTheyBuy: "A service that answers referrals for them.",
    insteadOfToday: "The owner answers them when they get a minute.",
    salesNavFilters: {
      titles: ["Founder"],
      seniorities: ["Owner"],
      industries: ["Marketing Services"],
      companyHeadcount: ["11-50"],
      geographies: ["United States"],
      keywords: [],
      excludeTitles: [],
    },
    hooks: [
      "Do new client intros still wait on the founder to reply?",
      "Is anyone on the team owning referral replies yet?",
      "How quickly does a warm intro get an answer at the agency?",
    ],
    connectionNote: "Hi {{first_name}}, I work with agency owners on referral follow-up.",
    followUps: [
      { delayDays: 2, message: "Worth a look?" },
      { delayDays: 4, message: "Closing the loop." },
    ],
    priority: 1,
  },
  {
    name: "Accounting firm partners",
    summary: "Partners at regional accounting firms whose clients refer other clients.",
    jobTitles: ["Partner"],
    seniority: ["Partner"],
    industries: ["Accounting"],
    companySize: "51-200",
    geography: ["United States"],
    triggerEvents: ["Opened a second office"],
    pains: ["Client referrals land with the wrong partner and stall during tax season"],
    valueProposition: "Referrals routed to the right partner the same day.",
    whatTheyBuy: "Referral routing and replies during busy season.",
    insteadOfToday: "A shared inbox somebody checks on Fridays.",
    salesNavFilters: {
      titles: ["Partner"],
      seniorities: ["Partner"],
      industries: ["Accounting"],
      companyHeadcount: ["51-200"],
      geographies: ["United States"],
      keywords: [],
      excludeTitles: [],
    },
    hooks: [
      "Do client referrals reach the right partner during tax season?",
      "Is busy season the time referrals quietly go missing?",
      "Who answers a referral when every partner is in returns?",
    ],
    connectionNote: "Hi {{first_name}}, I work with accounting partners on referrals.",
    followUps: [
      { delayDays: 2, message: "Worth a look?" },
      { delayDays: 4, message: "Closing the loop." },
    ],
    priority: 2,
  },
  {
    name: "IT consultancies",
    summary: "Heads of small IT consultancies who win work through partners.",
    jobTitles: ["CEO"],
    seniority: ["CXO"],
    industries: ["IT Services"],
    companySize: "11-50",
    geography: ["United States"],
    triggerEvents: ["New partner programme"],
    pains: ["Partner referrals get lost between sales and delivery"],
    valueProposition: "Partner referrals followed up the same day.",
    whatTheyBuy: "Follow-up on partner referrals.",
    insteadOfToday: "The CEO forwards emails.",
    salesNavFilters: {
      titles: ["CEO"],
      seniorities: ["CXO"],
      industries: ["IT Services"],
      companyHeadcount: ["11-50"],
      geographies: ["United States"],
      keywords: [],
      excludeTitles: [],
    },
    hooks: [
      "Do partner referrals reach sales the same day?",
      "Who owns a referral once it lands with delivery?",
      "Are partner intros tracked anywhere yet?",
    ],
    connectionNote: "Hi {{first_name}}, I work with IT consultancies on partner referrals.",
    followUps: [
      { delayDays: 2, message: "Worth a look?" },
      { delayDays: 4, message: "Closing the loop." },
    ],
    priority: 3,
  },
];

export const BUSINESS = {
  companyName: "Northbeam",
  oneLiner: "Northbeam answers every referral a service firm receives within the hour.",
  offering: "A referral desk that replies to warm introductions on the firm's behalf and books the first call.",
  pricingModel: "Monthly subscription",
  proofPoints: ["Average reply time under 40 minutes"],
  toneOfVoice: "Plain, warm and direct.",
  competitors: ["Shared inboxes"],
  commonObjections: ["We already reply to our own referrals"],
  differentiators: ["Replies within the hour"],
};

/** The opener Sage seeds for the agent. Written about strategy 1's pain, as `writeHooks` sees strategy 1 first. */
export const SEEDED_OPENER = "Do agency referrals still sit in an inbox for a week before anyone replies?";
export const SEEDED_PITCH = "We answer every referral you get within the hour, so none of them go cold.";

function between(text: string, start: string, end: string): string | null {
  const at = text.indexOf(start);
  if (at < 0) return null;
  const from = at + start.length;
  const to = text.indexOf(end, from);
  return to < 0 ? text.slice(from) : text.slice(from, to);
}

/** The JSON array that ends a prompt (the people to score or write for). */
function trailingArray(text: string): Array<Record<string, unknown>> {
  const at = text.lastIndexOf("\n\n[");
  return JSON.parse(text.slice(at + 2)) as Array<Record<string, unknown>>;
}

export class RecordingLlm implements LlmClient {
  readonly provider = "openai" as const;
  readonly models = { writer: "gpt-5-mini", classifier: "gpt-5-mini" };
  readonly calls: RecordedCall[] = [];
  /** What the classifier says about the next reply. */
  classification: Classification = classification();
  /**
   * When set, the campaign writer pastes the CTA's label into the last step
   * whatever the prompt says, as a real model sometimes does. Off by default:
   * the literal model only does what it is told.
   */
  stubbornCtaLabel = false;

  /** Every recorded call made by one agent. */
  by(agent: string): RecordedCall[] {
    return this.calls.filter((call) => call.agent === agent);
  }

  last(agent: string): RecordedCall | undefined {
    return this.by(agent).at(-1);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const system = request.system.map((block) => block.text).join("\n\n");
    const agent = identify(request, system);
    this.calls.push({ agent, model: request.model, system, user: request.user });
    return {
      parsed: this.answer(agent, system, request.user),
      refusal: null,
      incomplete: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    };
  }

  private answer(agent: string, system: string, user: string): unknown {
    switch (agent) {
      case "strategy":
        return { businessProfile: BUSINESS, customerProfiles: STRATEGIES };
      case "pitch":
        return {
          variants: [
            { name: "Fast replies", body: SEEDED_PITCH, angle: "Speed", factsUsed: [] },
            { name: "No admin", body: "We reply to your referrals for you, so the team keeps doing the work.", angle: "Time", factsUsed: [] },
            { name: "Booked calls", body: "We turn each referral into a booked first call within a day.", angle: "Calls", factsUsed: [] },
            { name: "Visibility", body: "You see every referral and every reply in one place.", angle: "Clarity", factsUsed: [] },
          ],
        };
      case "hook":
        return {
          variants: [
            { name: "Agency inbox", body: SEEDED_OPENER, angle: "Agency referrals going cold" },
            { name: "Owner", body: "Is the founder still the one who answers every intro?", angle: "Owner bottleneck" },
            { name: "Speed", body: "How long does a warm intro wait for a reply right now?", angle: "Speed" },
            { name: "Tracking", body: "Are referrals tracked anywhere yet?", angle: "Tracking" },
          ],
        };
      case "fit":
        return {
          scores: trailingArray(user).map((p) => ({
            providerId: p.providerId,
            fitScore: 85,
            reasons: ["Right role"],
            disqualified: false,
            disqualifyReason: null,
          })),
        };
      case "invite-note":
        return {
          notes: trailingArray(user).map((p) => ({
            providerId: p.providerId,
            note: `Hi ${String(p.name).split(" ")[0]}, saw you run things at ${String(p.company ?? "your firm")}. Open to connecting?`,
            grounding: ["company"],
            tooThin: false,
          })),
        };
      case "campaign":
        return campaignPlan(system, user, this.stubbornCtaLabel);
      case "first-message": {
        const who = JSON.parse(between(user, "Who they are:\n", "\n\nWrite")?.trim() ?? "{}") as { firstName?: string };
        return { message: `Thanks for accepting, ${who.firstName ?? "there"}. Is referral follow-up on your plate this quarter?` };
      }
      case "revise": {
        // A literal reviser: it fixes what the instruction names and nothing else.
        let message = between(user, 'The message:\n"""\n', '\n"""') ?? between(user, '"""\n', '\n"""') ?? "";
        const pasted = /It pastes "([^"]+)" into a sentence in title case/.exec(user)?.[1];
        if (pasted) message = message.split(pasted).join(pasted[0] + pasted.slice(1).toLowerCase());
        return { message };
      }
      case "classify":
        return this.classification;
      case "reply-draft":
        return replyDraft(system, user);
      case "comment": {
        const post = between(user, 'The post:\n"""\n', '\n"""') ?? "";
        const grounding = post.split(/\s+/).slice(0, 6).join(" ");
        return { comment: `Agree that ${grounding.toLowerCase()}, and it is good to see it said plainly.`, grounding, skip: false };
      }
      default:
        throw new Error(`RecordingLlm has no canned answer for ${agent}`);
    }
  }
}

function identify(request: LlmRequest, system: string): string {
  const shape = (request.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  const keys = Object.keys(shape);
  if (keys.includes("businessProfile")) return "strategy";
  if (keys.includes("scores")) return "fit";
  if (keys.includes("notes")) return "invite-note";
  if (keys.includes("intent")) return "classify";
  if (keys.includes("proposesMeeting")) return "reply-draft";
  if (keys.includes("comment") && keys.includes("grounding")) return "comment";
  if (keys.includes("connectionNote") && keys.includes("steps")) return "campaign";
  if (keys.includes("variants")) {
    if (request.user.includes("Write the pitches.")) return "pitch";
    if (request.user.includes("Write the openers.")) return "hook";
  }
  if (keys.length === 1 && keys[0] === "message") {
    return system.includes("has just accepted their connection request") ? "first-message" : "revise";
  }
  return `unknown(${keys.join(",")})`;
}

/**
 * The campaign a literal model writes from `ctaBrief`: step 1 a question,
 * step 2 the approved offer, the last step the call to action — named the way
 * the prompt says to name it, with `{{cta_link}}` where the prompt says.
 */
function campaignPlan(system: string, user: string, stubborn = false) {
  const cap = Number(/Daily invite cap is (\d+)/.exec(user)?.[1] ?? 20);
  const label =
    /Name it as "([^"]+)"/.exec(system)?.[1] ??
    (stubborn ? (/(?:Name it as|The business calls it) "([^"]+)"/.exec(system)?.[1] ?? null) : null);
  const kind = system.includes("Write {{cta_link}} where the address goes")
    ? "link"
    : system.includes("There is no link and no meeting")
      ? "reply"
      : "meeting";
  const ask =
    kind === "reply"
      ? "Is this worth a quick reply either way?"
      : `${label ? `${label} here` : kind === "meeting" ? "Grab a time here" : "Take a look here"}: {{cta_link}}`;
  const steps = [
    { delayDays: 1, message: "Thanks for connecting, {{first_name}}. Is referral follow-up something you look after?" },
    { delayDays: 2, message: "{{pitch}} Would that be useful for your team?" },
    { delayDays: 3, message: ask },
  ];
  return {
    name: "Northbeam outreach",
    connectionNote: "Hi {{first_name}}, I work with firms on referral follow-up.",
    variants: [
      {
        name: "Slow replies",
        angle: "Referrals that wait days for an answer.",
        painPoint: "Slow replies to warm intros",
        connectionNote: "Hi {{first_name}}, curious how fast referrals get a reply at your firm.",
        steps,
      },
      {
        name: "Lost referrals",
        angle: "Referrals that never reach the right person.",
        painPoint: "Referrals landing with the wrong person",
        connectionNote: "Hi {{first_name}}, curious who owns referrals at your firm.",
        steps,
      },
    ],
    steps: steps.map((step) => ({ kind: "follow_up", ...step })),
    stopConditions: ["prospect replies", "prospect opts out", "meeting booked"],
    dailyInviteCap: cap,
  };
}

/** A reply that does what the prompt allows and nothing it does not. */
function replyDraft(system: string, user: string) {
  const offer = between(system, 'THE OFFER, approved by the salesperson:\n"""\n', '\n"""');
  const pitchAllowed = user.includes("using the approved offer");
  const marker = "Times you may offer (at most two, exactly as written):\n";
  const block = user.includes(marker) ? user.slice(user.indexOf(marker) + marker.length) : "";
  const times = block
    ? block
        .split(/\n(?:The ONLY link|Do not write a link)/)[0]!
        .split("\n")
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const link = /The ONLY link you may send is (\S+?)\. Copy it exactly/.exec(user)?.[1] ?? null;
  const notMeeting = system.includes("This campaign is NOT asking for a meeting");

  const parts = [offer && pitchAllowed ? offer : "Happy to explain more."];
  if (times.length) parts.push(`Would ${times.join(" or ")} work for a quick call?`);
  else if (link) parts.push(notMeeting ? `Here is the page: ${link}` : `You can pick a time here: ${link}`);
  return {
    message: parts.join(" "),
    proposesMeeting: times.length > 0,
    proposedSlots: times,
    usedKnowledge: [],
    unansweredQuestions: [],
  };
}

/* ------------------------------------------------------------ the queue */

export interface StoredJob {
  name: string;
  data: LinkedInActionJob;
  state: string;
  timestamp: number;
  delay: number;
}

export function memoryQueue() {
  const jobs = new Map<string, StoredJob>();
  const queue = {
    add: async (name: string, data: LinkedInActionJob, opts: { jobId: string; delay?: number }) => {
      if (jobs.has(opts.jobId)) return { id: opts.jobId };
      jobs.set(opts.jobId, { name, data, state: "delayed", timestamp: Date.now(), delay: opts.delay ?? 0 });
      return { id: opts.jobId };
    },
    getJob: async (id: string) => {
      const job = jobs.get(id);
      if (!job) return undefined;
      return { getState: async () => job.state, remove: async () => void jobs.delete(id) };
    },
    getJobs: async (types: readonly string[]) =>
      [...jobs.values()]
        .filter((job) => types.includes(job.state))
        .map((job) => ({ name: job.name, data: job.data, timestamp: job.timestamp, delay: job.delay })),
    getJobCounts: async () => ({ delayed: [...jobs.values()].filter((j) => j.state === "delayed").length }),
  };
  const plain = { add: async () => ({ id: "x" }) };
  const queues = {
    strategy: plain,
    targeting: plain,
    campaignTick: plain,
    linkedinAction: queue,
    inbound: plain,
    maintenance: plain,
    digest: plain,
  } as unknown as Queues;
  return { jobs, queues };
}

/* ------------------------------------------------------------ the world */

export interface World {
  db: ValueFlowDb;
  llm: RecordingLlm;
  linkedin: MockLinkedInProvider;
  ctx: WorkerContext;
  jobs: Map<string, StoredJob>;
  queues: Queues;
}

export function world(): World {
  const db = new ValueFlowDb();
  const llm = new RecordingLlm();
  const linkedin = new MockLinkedInProvider();
  const { jobs, queues } = memoryQueue();
  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {
      LINKEDIN_PROVIDER: "mock",
      // The default (rule 18): the calendar this product owns.
      CALENDAR_PROVIDER: "own",
      CRM_PROVIDER: "mock",
      MEETING_DURATION_MINUTES: 30,
      APP_URL: "https://app.test",
      WORKER_URL: "https://worker.test",
    } as WorkerContext["env"],
    agentsFor: () => ({ client: llm }),
  } as unknown as WorkerContext;
  return { db, llm, linkedin, ctx, jobs, queues };
}

export function setNow(at: Date | string | number): Date {
  const date = new Date(at);
  vi.setSystemTime(date);
  return date;
}

export function now(): Date {
  return new Date();
}

/** When a stored job is due, by the worker's own reading (`jobDueAt`). */
export function dueAt(job: StoredJob): number {
  return jobDueAt({ data: job.data as { dueAt?: unknown }, timestamp: job.timestamp, delay: job.delay }, new Date());
}

/** Runs every delayed send-path job that is due, as the worker would, rescheduling refusals. */
export async function drain(w: World): Promise<number> {
  let ran = 0;
  for (const [id, job] of w.jobs) {
    if (job.state !== "delayed") continue;
    if (dueAt(job) > Date.now()) continue;
    try {
      await runLinkedInAction(w.ctx, job.data);
      job.state = "completed";
      ran += 1;
    } catch (err) {
      if (!(err instanceof RescheduleError)) throw new Error(`job ${id} threw: ${(err as Error).message}`);
      job.data = { ...job.data, dueAt: Date.now() + err.retryAfterMs } as LinkedInActionJob;
      job.delay = err.retryAfterMs;
    }
  }
  return ran;
}

/**
 * The worker running: a tick every five minutes and the send path draining
 * what is due, until `done` says so or `maxMinutes` of simulated time pass.
 */
export async function runWorker(w: World, done: () => boolean, maxMinutes = 24 * 60): Promise<boolean> {
  for (let elapsed = 0; elapsed <= maxMinutes; elapsed += 5) {
    await runCampaignTick(w.ctx.db, w.queues, new Date(), w.linkedin);
    await drain(w);
    if (done()) return true;
    setNow(Date.now() + 5 * MINUTE);
  }
  return false;
}

/** Hour, minute and weekday (0 = Sunday) of an instant, in a zone. */
export function localTime(at: number | Date, timezone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, hour: Number(get("hour")), minute: Number(get("minute")) };
}

/* ------------------------------------------------------------ onboarding */

export interface Answers {
  /** Business step (apps/web/src/lib/create-workspace.ts). */
  companyName: string;
  signupFullName: string;
  description: string;
  /** Connect step (apps/web/src/lib/approve.ts planFlags). */
  linkedinPlan: "basic" | "premium" | "sales_navigator";
  /** Hours step (apps/web/src/app/onboarding/save/route.ts case "hours"). */
  timezone: string;
  sending: { start: number; end: number; days: number[] };
  meeting: { start: number; end: number; days: number[]; minutes: number };
  /** Voice step (case "voice"). */
  voice: { fullName: string; bio: string };
  /** CTA step (case "cta"). */
  cta: { kind: "meeting" | "link" | "reply"; label: string | null; url?: string; bookingUrl?: string };
  /** Launch step (case "launch"): "check" is approval, "nora" is autopilot + autonomous. */
  handling: "check" | "nora";
  /** Whether the workspace still has liking/commenting on (/app/engagement toggle). */
  engagePosts?: boolean;
  /** The separate comment switch on the LinkedIn activity page (migration 0058). */
  engageComments?: boolean;
}

export const DEFAULT_ANSWERS: Answers = {
  companyName: "Northbeam",
  signupFullName: "Samantha Patel",
  description: "We answer referrals for service firms within the hour and book the first call.",
  linkedinPlan: "premium",
  timezone: "America/Los_Angeles",
  // 7am to 3pm Pacific, weekdays: an hours window UTC's default (8 to 18) disagrees with.
  sending: { start: 7, end: 15, days: [1, 2, 3, 4, 5] },
  // Calls only on Tuesday and Thursday afternoons, Pacific.
  meeting: { start: 13, end: 16, days: [2, 4], minutes: 30 },
  voice: { fullName: "Sam Patel", bio: "I ran the referral desk at a Chicago law firm for ten years." },
  cta: { kind: "meeting", label: "Book a Free Consultation", bookingUrl: "https://cal.com/sam-patel/intro" },
  handling: "nora",
};

/** apps/web/src/lib/create-workspace.ts + the strategy job it queues. */
export async function businessStep(w: World, a: Answers, options: { runSage?: boolean } = {}): Promise<void> {
  w.db.seed("workspaces", [
    {
      id: WORKSPACE,
      name: a.companyName,
      slug: "northbeam-x1",
      // Migration 0052: a new workspace gets fourteen days of Autopilot.
      plan: "trial",
      trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      subscription_status: null,
      onboarding: {
        workingHours: null,
        hasSalesNavigator: null,
        hasPremium: null,
        autonomy: null,
        source: { description: a.description },
      },
      engage_posts: a.engagePosts ?? true,
      ...(a.engageComments === undefined ? {} : { engage_comments: a.engageComments }),
    },
  ]);
  // create_workspace(p_full_name) writes the name; the business form's
  // timezone lands on the profile (create-workspace.ts profilePatch).
  w.db.seed("profiles", [{ id: USER, email: "sam@northbeam.test", full_name: a.signupFullName, bio: null, timezone: a.timezone }]);
  w.db.seed("memberships", [{ workspace_id: WORKSPACE, user_id: USER, role: "owner" }]);
  if (options.runSage ?? true) await runSage(w, a);
}

/** The /jobs/strategy job the business step queues (Sage). */
export async function runSage(w: World, a: Answers): Promise<void> {
  await runStrategyJob(w.ctx, { workspaceId: WORKSPACE, userId: USER, description: a.description });
}

/** save/route.ts case "linkedin-connect", the worker's /auth/linkedin/link row, and the provider's claim. */
export function linkedinStep(w: World, a: Answers): string {
  const flags =
    a.linkedinPlan === "sales_navigator"
      ? { has_sales_navigator: true, has_premium: true }
      : a.linkedinPlan === "premium"
        ? { has_sales_navigator: false, has_premium: true }
        : { has_sales_navigator: false, has_premium: false };
  const ws = w.db.find("workspaces", { id: WORKSPACE })!;
  ws.onboarding = { ...(ws.onboarding as Row), hasSalesNavigator: flags.has_sales_navigator, hasPremium: flags.has_premium };
  const id = "aaaaaaaa-0000-4000-8000-0000000000ac";
  w.db.seed("linkedin_accounts", [
    {
      id,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider: "mock",
      ...flags,
      // claimAccount (server.ts): the provider's account, active, connected now.
      provider_account_id: ACCOUNT_PROVIDER_ID,
      status: "active",
      status_detail: null,
      connected_at: new Date().toISOString(),
      counters_reset_on: null,
    },
  ]);
  return id;
}

/** save/route.ts case "hours". */
export function hoursStep(w: World, a: Answers, accountId: string): void {
  w.db.find("profiles", { id: USER })!.timezone = a.timezone;
  w.db.find("linkedin_accounts", { id: accountId })!.working_hours = { ...a.sending };
  const ws = w.db.find("workspaces", { id: WORKSPACE })!;
  ws.onboarding = { ...(ws.onboarding as Row), workingHours: { ...a.sending } };
  // saveAvailability (apps/web/src/lib/availability.ts)
  w.db.seed("availability", [
    {
      workspace_id: WORKSPACE,
      user_id: USER,
      timezone: a.timezone,
      working_hours: { start: a.meeting.start, end: a.meeting.end, days: a.meeting.days },
      meeting_minutes: a.meeting.minutes,
      min_notice_hours: 12,
      buffer_minutes: 15,
      max_per_day: 3,
      location: null,
      updated_at: new Date().toISOString(),
    },
  ]);
  stamp(w, "hours");
}

/** save/route.ts case "voice" + carryVoiceToAgent (apps/web/src/lib/agent-voice.ts). */
export function voiceStep(w: World, a: Answers): void {
  const profile = w.db.find("profiles", { id: USER })!;
  const before = { fullName: (profile.full_name as string | null) ?? null, bio: (profile.bio as string | null) ?? null };
  profile.full_name = a.voice.fullName;
  profile.bio = a.voice.bio || null;
  const agent = w.db.rows("agents").find((row) => row.workspace_id === WORKSPACE && row.is_default === true && !row.archived_at);
  if (agent) {
    const fromName = String(agent.from_name ?? "").trim();
    const nameIsOurs = !fromName || fromName === (before.fullName?.trim() ?? "");
    if (nameIsOurs && fromName !== a.voice.fullName) agent.from_name = a.voice.fullName;
    agent.system_prompt = withRepBio(String(agent.system_prompt ?? ""), a.voice.bio || null, before.bio);
  }
  stamp(w, "voice");
}

/** save/route.ts case "cta" + ensureCta (apps/web/src/lib/cta-library.ts). */
export function ctaStep(w: World, a: Answers): string {
  const { kind, label } = a.cta;
  const url = kind === "link" ? (a.cta.url ?? null) : null;
  if (kind === "meeting" && a.cta.bookingUrl) w.db.find("profiles", { id: USER })!.booking_url = a.cta.bookingUrl;
  const ctaId = ensureCta(w, { kind, label, url });
  const taken = new Set(w.db.rows("campaigns").map((c) => c.customer_profile_id).filter(Boolean));
  for (const profile of w.db.rows("customer_profiles")) {
    if (profile.workspace_id !== WORKSPACE || taken.has(profile.id)) continue;
    Object.assign(profile, { cta_kind: kind, cta_label: label, cta_url: url, cta_id: ctaId });
  }
  const ws = w.db.find("workspaces", { id: WORKSPACE })!;
  ws.onboarding = { ...(ws.onboarding as Row), cta: { kind, label, url } };
  stamp(w, "cta", { ctaChoice: { kind, label, url } });
  return ctaId;
}

function ensureCta(w: World, cta: { kind: "meeting" | "link" | "reply"; label: string | null; url: string | null }): string {
  const url = CTA_DEFINITIONS[cta.kind].needsUrl ? cta.url : null;
  const words = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const wanted = words(cta.label || CTA_DEFINITIONS[cta.kind].label);
  const same = w.db
    .rows("ctas")
    .find(
      (row) =>
        row.workspace_id === WORKSPACE &&
        row.kind === cta.kind &&
        !row.archived_at &&
        (url ? row.url === url : row.url == null) &&
        words(row.label || row.name) === wanted,
    );
  if (same) return same.id as string;
  const id = `cccccccc-0000-4000-8000-${String(w.db.rows("ctas").length + 1).padStart(12, "0")}`;
  w.db.seed("ctas", [
    {
      id,
      workspace_id: WORKSPACE,
      name: cta.label?.trim() || CTA_DEFINITIONS[cta.kind].label,
      kind: cta.kind,
      label: cta.label,
      url,
      created_by: USER,
      archived_at: null,
    },
  ]);
  return id;
}

function stamp(w: World, key: string, extra: Row = {}): void {
  const profile = w.db.find("profiles", { id: USER })!;
  const all = (profile.setup_confirmed as Record<string, Row> | undefined) ?? {};
  profile.setup_confirmed = { ...all, [WORKSPACE]: { ...(all[WORKSPACE] ?? {}), ...extra, [key]: new Date().toISOString() } };
}

/** The strategy row Sage wrote under this name. */
export function strategyId(w: World, name: string): string {
  const row = w.db.rows("customer_profiles").find((p) => p.name === name);
  if (!row) throw new Error(`no strategy called ${name}`);
  return row.id as string;
}

/**
 * save/route.ts case "approve": approveStrategy with the confirmed CTA, then
 * queueSearch → /jobs/targeting → runTargetingJob (the worker's own job).
 */
export async function approveStep(
  w: World,
  profileId: string,
  accountId: string,
  people: ProspectCandidate[],
): Promise<string | null> {
  const confirmations = ((w.db.find("profiles", { id: USER })!.setup_confirmed as Record<string, Row>)[WORKSPACE] ?? {}) as Row;
  const cta = (confirmations.ctaChoice ?? (w.db.find("workspaces", { id: WORKSPACE })!.onboarding as Row).cta) as
    | { kind: "meeting" | "link" | "reply"; label: string | null; url: string | null }
    | undefined;
  const hasCampaign = w.db.rows("campaigns").some((c) => c.customer_profile_id === profileId);
  const profile = w.db.find("customer_profiles", { id: profileId })!;
  profile.approved_at = new Date().toISOString();
  profile.do_not_pursue = false;
  if (cta && !hasCampaign) {
    Object.assign(profile, { cta_kind: cta.kind, cta_label: cta.label, cta_url: cta.url, cta_id: ensureCta(w, cta) });
  }
  w.linkedin.candidates = { items: people, cursor: null, droppedFilters: [] };
  return runTargetingJob(w.ctx, {
    workspaceId: WORKSPACE,
    userId: USER,
    customerProfileId: profileId,
    linkedinAccountId: accountId,
    limit: 50,
  });
}

/**
 * save/route.ts case "launch": setReplyHandling (apps/web/src/lib/autonomy.ts),
 * the seeded opener and offer approved as shown, launch (apps/web/src/lib/launch.ts)
 * and the /jobs/campaign-tick kick, which runs the pacing loop.
 */
export async function launchStep(w: World, a: Answers, campaignId: string): Promise<number> {
  const autonomy = a.handling === "nora" ? "autonomous" : "supervised";
  const replyMode = a.handling === "nora" ? "autopilot" : "approval";
  // setAutonomy: the workspace answer, then every campaign.
  const ws = w.db.find("workspaces", { id: WORKSPACE })!;
  ws.onboarding = { ...(ws.onboarding as Row), autonomy };
  for (const campaign of w.db.rows("campaigns").filter((c) => c.workspace_id === WORKSPACE)) {
    campaign.rules = { ...((campaign.rules as Row) ?? {}), autonomy };
    campaign.reply_mode = replyMode;
  }
  // The opener and offer the launch screen shows: the default agent's own lines.
  const agent = w.db.rows("agents").find((row) => row.workspace_id === WORKSPACE && row.is_default === true);
  for (const table of ["hooks", "pitches"]) {
    for (const line of w.db.rows(table)) {
      if (line.agent_id === agent?.id && !line.approved_at) {
        line.approved_at = new Date().toISOString();
        line.approved_by = USER;
      }
    }
  }
  const campaign = w.db.find("campaigns", { id: campaignId })!;
  campaign.status = "running";
  campaign.launched_at = new Date().toISOString();
  return runCampaignTick(w.ctx.db, w.queues, new Date(), w.linkedin);
}

/** Two real-looking people with public addresses, for a search to return. */
export function people(prefix: string, company: string): ProspectCandidate[] {
  return [1, 2].map((n) => ({
    providerId: `prov_${prefix}_${n}`,
    linkedinUrl: `https://www.linkedin.com/in/${prefix}-person-${n}`,
    firstName: n === 1 ? "Jane" : "Omar",
    lastName: `${prefix}${n}`,
    headline: `Founder at ${company}`,
    title: "Founder",
    company,
    signals: [],
  }));
}

/** A post of the prospect's own, recent and long enough to comment on. */
export function post(id: string, at: Date): ProviderPost {
  return {
    socialId: `urn:li:activity:${id}`,
    url: `https://www.linkedin.com/feed/update/${id}`,
    text:
      "Referral partners are the quiet engine of our agency. This quarter we started tracking how long each warm intro waited for a first reply, and the answer surprised the whole team in a good way.",
    postedAt: new Date(at.getTime() - 2 * 86_400_000).toISOString(),
    isRepost: false,
    canReact: true,
    canComment: true,
  };
}

export type { ProspectCandidate };
