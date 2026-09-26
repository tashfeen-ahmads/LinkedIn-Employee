import {
  BOOT_BEAT,
  MAINTENANCE_BEAT,
  MESSAGE_WEBHOOK_BEAT,
  MAINTENANCE_STALE_MS,
  PACING_LOOP,
  PACING_STALE_MS,
} from "@le/shared";
import { isAccountGone } from "@le/linkedin";
import type { WorkerContext } from "../context.js";

/**
 * Every precondition between signing up and a booked meeting, checked against
 * what is actually true right now.
 *
 * This exists because of how the first live deployment went. Each stage failed
 * silently in its own way — a queue that accepted a job and returned nothing, a
 * connected account the provider had dropped, a search sent with words where
 * LinkedIn wanted ids — and each one was found by reasoning from a screen that
 * looked the same in every case. Days of that. The checks below turn "nothing
 * happened" into a named stage, a reason, and the one thing to do about it.
 *
 * Two rules it follows. It never reports a stage as passing because it could
 * not look: something it cannot determine says so. And it asks the provider
 * rather than trusting a row, because the row saying `active` while the
 * provider had never heard of the account is exactly what cost a week.
 */

export type CheckState = "ok" | "blocked" | "waiting" | "unknown" | "todo";

export interface Check {
  key: string;
  stage: string;
  label: string;
  state: CheckState;
  /**
   * What is true, said to the person who owns the workspace.
   *
   * Their language and their concerns: what is happening to their campaigns
   * and what it costs them. Never the name of a vendor we buy from, never an
   * environment variable, never a URL path in this deployment. A business
   * owner does not know what those are, cannot change any of them, and does
   * not need to learn our supply chain to use the product.
   */
  detail: string;
  /** What *they* can do about it, when there is something they can do. */
  fix?: string;
  href?: string;
  /**
   * The same fault, for whoever operates the deployment.
   *
   * Rendered only for a platform admin. This is where the vendor, the
   * variable and the exact remedy live — a real fix, written for somebody who
   * can actually apply it.
   *
   * Splitting the two is not politeness. A row telling a customer to set
   * `UNIPILE_WEBHOOK_SECRET` assigns repair to somebody who has no access to
   * it, which is rule 8 one step worse: repair that does not merely wait for
   * someone to find a button, but waits for someone who could never press it.
   */
  operator?: string;
}

export interface DiagnosticsReport {
  checkedAt: string;
  checks: Check[];
}

/**
 * Outstanding invitations past which LinkedIn starts refusing new ones.
 *
 * There is no published number and there never will be — this is the
 * conservative end of what practitioners report, chosen so the screen says
 * something before the sending stops rather than after.
 */
const PENDING_CROWDED = 200;

/** The provider's own field names, so a wrong mapping cannot report a confident zero. */
function describeShape(raw: unknown): string {
  if (Array.isArray(raw)) return `an array of ${raw.length}`;
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw as Record<string, unknown>);
    return keys.length ? `an object with ${keys.slice(0, 8).join(", ")}` : "an empty object";
  }
  return `${typeof raw}`;
}

const STAGES = {
  setup: "Deployment",
  onboarding: "Onboarding",
  strategy: "Strategy Agent",
  account: "LinkedIn account",
  targeting: "Targeting Agent",
  campaign: "Campaign",
  replies: "Reply Agent",
  calendar: "Meetings",
} as const;

export async function runDiagnostics(
  ctx: WorkerContext,
  input: { workspaceId: string; userId: string },
): Promise<DiagnosticsReport> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const { db, env } = ctx;

  // ---- Deployment -------------------------------------------------------
  const hasModelKey = Boolean(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
  add({
    key: "model-provider",
    stage: STAGES.setup,
    label: "Your agents can run",
    state: hasModelKey ? "ok" : "blocked",
    detail: hasModelKey
      ? "The agents that write your strategy, your invitations and your replies are ready."
      : "No agent can run, so nothing gets written: no strategy, no invitation notes, no replies. This is ours to fix rather than yours.",
    fix: hasModelKey ? undefined : "Nothing to change on your side. Raise it with support and we will fix it.",
    href: hasModelKey ? undefined : "/app/support",
    operator: hasModelKey
      ? `Agents run on ${env.OPENAI_API_KEY ? "OpenAI" : "Anthropic"}.`
      : "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set. Set one on the worker and redeploy.",
  });

  const live = env.LINKEDIN_PROVIDER !== "mock";
  add({
    key: "linkedin-provider",
    stage: STAGES.setup,
    label: "Sending is live",
    state: live ? "ok" : "waiting",
    detail: live
      ? "Connected to LinkedIn. Real invitations and messages will be sent."
      : "This is a test setup. Nothing reaches a real LinkedIn account.",
    operator: live ? undefined : "LINKEDIN_PROVIDER is `mock`. Set it to `unipile` to send for real.",
  });

  add({
    key: "webhook-secret",
    stage: STAGES.setup,
    label: "Incoming replies are secured",
    state: env.UNIPILE_WEBHOOK_SECRET ? "ok" : live ? "blocked" : "waiting",
    detail: env.UNIPILE_WEBHOOK_SECRET
      ? "Replies are checked before they are let in, so nobody can write into your inbox pretending to be a prospect."
      : "Replies from prospects cannot be accepted yet, so your agent never sees them. This is ours to fix, not yours.",
    fix: env.UNIPILE_WEBHOOK_SECRET
      ? undefined
      : "Nothing to change on your side. Raise it with support and we will fix it.",
    href: env.UNIPILE_WEBHOOK_SECRET ? undefined : "/app/support",
    operator: env.UNIPILE_WEBHOOK_SECRET
      ? undefined
      : "Set UNIPILE_WEBHOOK_SECRET to the value in Unipile's webhook settings.",
  });

  // ---- Onboarding and Strategy -----------------------------------------
  const [{ data: business }, { data: profiles }, { data: lastStrategy }] = await Promise.all([
    db.from("business_profiles").select("id").eq("workspace_id", input.workspaceId).limit(1),
    db.from("customer_profiles").select("id, approved_at, do_not_pursue").eq("workspace_id", input.workspaceId),
    db
      .from("events")
      .select("name, payload, created_at")
      .eq("workspace_id", input.workspaceId)
      .in("name", ["strategy.queued", "strategy.failed", "strategy.profile.created"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const hasBusiness = (business ?? []).length > 0;
  const asked = Boolean(lastStrategy);
  add({
    key: "onboarding",
    stage: STAGES.onboarding,
    label: "Someone has said what this business sells",
    state: asked || hasBusiness ? "ok" : "todo",
    detail: asked || hasBusiness ? "Onboarding was submitted." : "Nobody has completed onboarding yet.",
    fix: asked || hasBusiness ? undefined : "Fill in onboarding.",
    href: asked || hasBusiness ? undefined : "/onboarding",
  });

  const failed = lastStrategy?.name === "strategy.failed";
  add({
    key: "strategy-run",
    stage: STAGES.strategy,
    label: "The Strategy Agent has written the profiles",
    state: hasBusiness ? "ok" : failed ? "blocked" : asked ? "waiting" : "todo",
    detail: hasBusiness
      ? `${(profiles ?? []).length} customer profile${(profiles ?? []).length === 1 ? "" : "s"} written.`
      : failed
        ? `The last run failed: ${String((lastStrategy?.payload as { reason?: unknown })?.reason ?? "no reason recorded")}`
        : asked
          ? `Running since ${lastStrategy?.created_at}. It reads the site and writes three to five customer profiles.`
          : "Not started, because onboarding has not been submitted.",
    fix: failed ? "Run onboarding again." : undefined,
    href: failed ? "/onboarding" : undefined,
  });

  const approved = (profiles ?? []).filter((p) => p.approved_at && !p.do_not_pursue);
  add({
    key: "approval",
    stage: STAGES.strategy,
    label: "A customer profile has been approved",
    state: approved.length > 0 ? "ok" : hasBusiness ? "todo" : "waiting",
    detail:
      approved.length > 0
        ? `${approved.length} approved.`
        : hasBusiness
          ? "None approved. Nothing is searched for until a human has read one and said yes — that is deliberate."
          : "Nothing to approve yet.",
    fix: approved.length === 0 && hasBusiness ? "Read one and approve it." : undefined,
    href: approved.length === 0 && hasBusiness ? "/app/strategy" : undefined,
  });

  // ---- The LinkedIn account, asked of the provider ----------------------
  const { data: account } = await db
    .from("linkedin_accounts")
    .select("id, provider_account_id, status, status_detail, has_sales_navigator")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .maybeSingle();

  add({
    key: "account-row",
    stage: STAGES.account,
    label: "A LinkedIn account is connected here",
    state: account?.status === "active" ? "ok" : account ? "blocked" : "todo",
    detail: account
      ? `This workspace has an account in state "${account.status}"${account.status_detail ? `: ${account.status_detail}` : "."}`
      : "No LinkedIn account has been connected.",
    fix: account?.status === "active" ? undefined : "Connect LinkedIn.",
    href: account?.status === "active" ? undefined : "/app/team",
  });

  // The check the first deployment did not have. The row said active for a
  // week while Unipile had never heard of the id it was holding.
  const providerCheck = await probeAccount(ctx, account?.provider_account_id ?? null);
  add({ ...providerCheck, stage: STAGES.account, key: "account-live" });

  // The disagreement itself, named. A rep reconnects, the provider issues a
  // new account with a new id, and our row still holds the old one — so their
  // provider dashboard shows a healthy green connection while this product
  // shows "reauth required". Two screens contradicting each other and no way
  // to tell which is right is the worst report this product can give.
  if (providerCheck.state === "blocked" || (account && account.status !== "active")) {
    add({ ...(await probeReplacement(ctx, input.userId, account?.provider_account_id ?? null)), stage: STAGES.account, key: "account-replacement" });
  }

  // ---- Can we actually search? -----------------------------------------
  const searchCheck = await probeSearch(ctx, account?.provider_account_id ?? null, providerCheck.state);
  add({ ...searchCheck, stage: STAGES.targeting, key: "search" });

  /*
   * How many invitations LinkedIn still has outstanding for this account.
   *
   * The question nobody was asking, and the one that explains a fortnight.
   * LinkedIn caps *pending* invitations — every request sent and never
   * answered — and past that ceiling it refuses new ones outright. Our own
   * records only know the invitations this product issued, so an account that
   * arrives carrying hundreds from before it ever signed up looks, from every
   * screen here, like a mysterious throttle: seven sent, an eighth refused,
   * and a cheerful "temporary provider limit, try again later" that never
   * comes right however long anybody waits.
   *
   * The endpoint to ask has been in `unipile.ts` since the first week and
   * nothing ever called it. Asked rather than inferred, for the reason rule 17
   * gives: a check that passes because it could not look costs the same week
   * every time.
   */
  if (account?.provider_account_id) {
    const provider = ctx.linkedin as {
      listPendingInvitations?: (input: { accountId: string; limit?: number }) => Promise<{
        invitations: Array<{ sentAt: string | null }>;
        raw: unknown;
        truncated?: boolean;
      }>;
    };
    if (typeof provider.listPendingInvitations === "function") {
      try {
        const { invitations, raw, truncated } = await provider.listPendingInvitations({
          accountId: account.provider_account_id,
          limit: 500,
        });
        const count = invitations.length;
        const atLeast = truncated ? "at least " : "";
        // The provider's own field names, when the list came back empty. A
        // mapping that is wrong reports a confident zero, and a confident zero
        // here is the difference between "your account is fine" and "your
        // account cannot send" (rule 17's disease, one layer down).
        const shape =
          count === 0
            ? ` The provider returned ${describeShape(raw)}.`
            : "";
        add({
          key: "pending-invitations",
          stage: STAGES.account,
          label: "Invitations LinkedIn is still holding",
          state: count >= PENDING_CROWDED ? "blocked" : "ok",
          detail:
            count >= PENDING_CROWDED
              ? `${atLeast}${count} invitations are still waiting for an answer. LinkedIn refuses new ones once too many are outstanding, and this is the most common reason an account that has sent almost nothing through us cannot send at all.`
              : `${atLeast}${count} invitation${count === 1 ? "" : "s"} outstanding, which is well inside what LinkedIn tolerates.${shape}`,
          fix:
            count >= PENDING_CROWDED
              ? "Withdraw the oldest ones to make room. Nothing else this product does will clear it."
              : undefined,
          href: "/app/team",
        });
      } catch (err) {
        add({
          key: "pending-invitations",
          stage: STAGES.account,
          label: "Invitations LinkedIn is still holding",
          state: "unknown",
          detail: `Could not ask the provider: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // A search that runs and finds nobody, at the widest setting this product
  // will go to, is not an answer LinkedIn really gives — it means a field in
  // the body is silently matching nothing. Working out which one by editing
  // code and asking somebody to press a button is a round trip per guess, so
  // every candidate is asked at once and the counts reported.
  if (searchCheck.state === "waiting" && account?.provider_account_id) {
    const probe = ctx.linkedin as { probeSearch?: (id: string) => Promise<Array<{ label: string; count: number | null; error?: string }>> };
    if (typeof probe.probeSearch === "function") {
      try {
        const rows = await probe.probeSearch(account.provider_account_id);
        const working = rows.filter((r) => (r.count ?? 0) > 0).map((r) => r.label);
        add({
          key: "search-probe",
          stage: STAGES.targeting,
          label: "Which search filters LinkedIn honours",
          state: working.length > 0 ? "blocked" : "unknown",
          detail: rows
            .map((r) => `${r.label}: ${r.error ? `refused — ${r.error}` : `${r.count} result${r.count === 1 ? "" : "s"}`}`)
            .join(" · "),
          fix:
            working.length > 0
              ? `These forms return people: ${working.join(", ")}. The ones returning nothing are what is emptying your searches.`
              : "Nothing returns a result, including a search with no filters at all — which points at the account or the subscription rather than the query.",
        });
      } catch (err) {
        console.error("search probe failed", err);
      }
    }
  }

  // ---- Campaigns --------------------------------------------------------
  const { data: campaigns } = await db
    .from("campaigns")
    .select("id, status, launched_at")
    .eq("workspace_id", input.workspaceId);
  const launched = (campaigns ?? []).filter((c) => c.launched_at);

  add({
    key: "campaign",
    stage: STAGES.campaign,
    label: "A campaign has been built",
    state: (campaigns ?? []).length > 0 ? "ok" : approved.length > 0 ? "todo" : "waiting",
    detail:
      (campaigns ?? []).length > 0
        ? `${campaigns!.length} campaign${campaigns!.length === 1 ? "" : "s"}, ${launched.length} launched.`
        : approved.length > 0
          ? "None yet. Run the Targeting Agent from an approved profile."
          : "Nothing to build a campaign from yet.",
    fix: (campaigns ?? []).length === 0 && approved.length > 0 ? "Find prospects." : undefined,
    href: (campaigns ?? []).length === 0 && approved.length > 0 ? "/app/strategy" : undefined,
  });

  add({
    key: "launched",
    stage: STAGES.campaign,
    label: "A campaign is live",
    state: launched.length > 0 ? "ok" : (campaigns ?? []).length > 0 ? "todo" : "waiting",
    detail:
      launched.length > 0
        ? `${launched.length} sending.`
        : (campaigns ?? []).length > 0
          ? "Built but not launched. Read the names and the copy, then launch — nothing sends until you do."
          : "No campaign to launch.",
    fix: launched.length === 0 && (campaigns ?? []).length > 0 ? "Review and launch." : undefined,
    href: launched.length === 0 && (campaigns ?? []).length > 0 ? "/app/campaigns" : undefined,
  });

  // The loop that actually sends, asked whether it is alive.
  //
  // Everything above this line can be perfect — approved profile, active
  // account, launched campaign, people queued — and not one message will leave
  // the building if this is not running. It is the only check here whose
  // failure makes every other green tick meaningless, and it was missing for
  // the entire first live launch.
  const { data: beats } = await db
    .from("worker_heartbeats")
    .select("name, beat_at, detail")
    .in("name", [PACING_LOOP, BOOT_BEAT, MAINTENANCE_BEAT, MESSAGE_WEBHOOK_BEAT]);
  const beat = (beats ?? []).find((b) => b.name === PACING_LOOP);
  const boot = (beats ?? []).find((b) => b.name === BOOT_BEAT);
  const bootDetail =
    boot?.detail && typeof boot.detail === "object" ? (boot.detail as Record<string, unknown>) : {};
  const beatAge = beat?.beat_at ? Date.now() - new Date(beat.beat_at).getTime() : null;
  const beating = beatAge !== null && beatAge <= PACING_STALE_MS;

  // Two stamps, because one cannot answer the question. The pacing stamp is
  // written by a loop that needs the queue to run at all, so a dead queue and a
  // dead process erase it identically — and they need different people to do
  // different things. The boot stamp goes straight to the database as the
  // process starts, which is what makes it readable in exactly the failure
  // that erases everything else.
  const queueDown = Boolean(boot) && bootDetail.queueReachable === false;
  add({
    key: "worker-boot",
    stage: STAGES.campaign,
    label: "The sending service is up",
    state: boot ? (queueDown ? "blocked" : "ok") : "unknown",
    detail: !boot
      ? "It has not reported starting, so we cannot say whether it is running. If a campaign of yours is not sending, tell us and we will look."
      : queueDown
        ? `Started ${boot.beat_at}, and cannot reach the list of work it sends from. Nothing you launch will be picked up. This is ours to fix rather than yours.`
        : `Running since ${boot.beat_at}.`,
    fix: queueDown ? "Nothing to change on your side. Raise it with support and we will fix it." : undefined,
    href: queueDown ? "/app/support" : undefined,
    operator: !boot
      ? "No BOOT_BEAT row. Either the process is down or the build carrying the stamp has not deployed — check both before restarting anything."
      : queueDown
        ? `Could not reach the queue at ${typeof bootDetail.redisHost === "string" ? bootDetail.redisHost : "its configured address"}. Point REDIS_URL at a reachable queue and redeploy.`
        : typeof bootDetail.commit === "string"
          ? `Build ${bootDetail.commit.slice(0, 7)}, queue reachable.`
          : "Queue reachable.",
  });

  /*
   * Whether replies are actually arriving — not whether we configured a secret.
   *
   * The check above this one asks whether `UNIPILE_WEBHOOK_SECRET` is set, and
   * it answered `ok` throughout the failure it was written to catch. Unipile
   * was calling this deployment, carrying no signature header at all, and the
   * worker was rejecting all of it: a prospect replied, the conversation was
   * live on LinkedIn, and the product's own inbox was empty. A check that
   * passes because it could not look sends somebody to investigate the wrong
   * stage, which is rule 17 exactly.
   *
   * So this one reads what the endpoint itself recorded. The two refusals need
   * different people to do different things, and they are told apart by whether
   * a signature arrived at all: no header is the webhook configured without
   * one, and a header that does not verify is the wrong secret on one side.
   */
  const webhook = (beats ?? []).find((b) => b.name === MESSAGE_WEBHOOK_BEAT);
  const webhookDetail =
    webhook?.detail && typeof webhook.detail === "object"
      ? (webhook.detail as Record<string, unknown>)
      : {};
  const rejected = Boolean(webhook) && webhookDetail.ok === false;
  const unsigned = rejected && webhookDetail.hadSignature === false;
  add({
    key: "webhook-deliveries",
    stage: STAGES.replies,
    label: "Replies from prospects are getting in",
    // Never delivered is `waiting`, never `ok`: a campaign that has had no
    // reply yet and a webhook that has never been pointed here look identical
    // from this row, and reporting the second as working is how a week goes.
    state: !webhook ? "waiting" : rejected ? "blocked" : "ok",
    detail: !webhook
      ? "No reply has come through to this inbox yet. That is normal before your first prospect answers — if somebody has replied on LinkedIn and it is not here, tell us."
      : rejected
        ? "A reply was sent to us and we could not accept it, so it stayed on LinkedIn instead of arriving here. This is a fault on our side and we can see it."
        : `Replies are arriving. The last one came through at ${webhook.beat_at}.`,
    // Nothing for the customer to do but tell us, because there is nothing
    // else they *can* do: the fault and the remedy are both on our side.
    fix: rejected ? "Nothing to change on your side. Raise it with support and we will fix it." : undefined,
    href: rejected ? "/app/support" : undefined,
    operator: !webhook
      ? "Unipile has never called this deployment. Point its messaging webhook at this worker's /webhooks/unipile/messages."
      : unsigned
        ? `Unipile called at ${webhook.beat_at} with no signature header. In its webhook settings add the \`unipile-signature\` header with the same value as UNIPILE_WEBHOOK_SECRET — the endpoint refuses an unsigned delivery on purpose and will keep doing so.`
        : rejected
          ? `Unipile called at ${webhook.beat_at} and the signature did not verify (${String(webhookDetail.reason ?? "no reason recorded")}). Make UNIPILE_WEBHOOK_SECRET and the value in Unipile's webhook settings match.`
          : undefined,
  });

  add({
    key: "pacing-loop",
    stage: STAGES.campaign,
    label: "The sending loop is running",
    state: beating ? "ok" : "blocked",
    detail: beating
      ? `Last ran ${Math.max(0, Math.round(beatAge! / 60_000))} minutes ago. It wakes every five.${lastDecision(beat)}`
      : beat?.beat_at
        ? `It last ran ${new Date(beat.beat_at).toISOString()} and should run every five minutes. Nothing you have launched is being sent.`
        : "It has never reported in. Nothing is being sent, whatever the campaign screens say.",
    // The row above names the cause when it can. This one says what it costs.
    fix: beating ? undefined : "Nothing to change on your side. Raise it with support and we will fix it.",
    href: beating ? undefined : "/app/support",
    operator: beating
      ? undefined
      : "The row above says which it is: the process down, or the process up and unable to reach its queue.",
  });

  // Nightly maintenance, which is where every promise that is not a campaign
  // gets kept: data erased at the retention limit, invitations withdrawn before
  // they sour an account's acceptance rate, approved replies that were never
  // dispatched picked back up, accounts repaired.
  //
  // None of it has any output on a screen, so a month of it not running looks
  // exactly like a month of it running and finding nothing to do — and one of
  // those is a promise about other people's data quietly not being kept.
  const nightly = (beats ?? []).find((b) => b.name === MAINTENANCE_BEAT);
  const nightlyDetail =
    nightly?.detail && typeof nightly.detail === "object"
      ? (nightly.detail as { ok?: boolean; failed?: unknown })
      : {};
  const nightlyFailed = Array.isArray(nightlyDetail.failed) ? (nightlyDetail.failed as string[]) : [];
  const nightlyAge = nightly?.beat_at ? Date.now() - new Date(nightly.beat_at).getTime() : null;
  const nightlyFresh = nightlyAge !== null && nightlyAge <= MAINTENANCE_STALE_MS;

  add({
    key: "maintenance",
    stage: STAGES.campaign,
    label: "Nightly housekeeping ran",
    // A run that finished with failed steps is not `ok`, and a deployment that
    // has never run it reports `unknown` rather than `blocked`: that is also
    // what a worker looks like on its first day, and sending somebody to
    // investigate a healthy new deployment is its own wasted hour.
    // A night with failed steps reports `blocked`, not `ok`: the promises those
    // particular steps keep are not being kept, and the detail names which. The
    // rule on this page is that nothing reports as working because part of it
    // did — the same reason a skipped check says `waiting` rather than `ok`.
    state: !nightly ? "unknown" : !nightlyFresh || nightlyFailed.length ? "blocked" : "ok",
    detail: !nightly
      ? "It has not reported yet. It runs at 3am, so an account less than a day old has simply not reached its first run."
      : !nightlyFresh
        ? `It last finished ${new Date(nightly.beat_at).toISOString()} and runs nightly. Invitations that went unanswered are not being withdrawn, and data past its retention limit is not being erased.`
        : nightlyFailed.length
          ? `Ran, with ${nightlyFailed.length} step(s) failing: ${nightlyFailed.join(", ")}. The rest of the night still finished.`
          : `Ran cleanly ${new Date(nightly.beat_at).toISOString()}.`,
    fix:
      !nightly || (nightlyFresh && !nightlyFailed.length)
        ? undefined
        : "Nothing to change on your side. Raise it with support and we will fix it.",
    href:
      !nightly || (nightlyFresh && !nightlyFailed.length) ? undefined : "/app/support",
    operator: !nightly
      ? undefined
      : !nightlyFresh
        ? "Check the worker is running and its schedule is registered."
        : nightlyFailed.length
          ? "Read the worker log for those steps; the rest of the night finished."
          : undefined,
  });

  // ---- Replies ----------------------------------------------------------
  const { count: knowledge } = await db
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId);

  add({
    key: "knowledge",
    stage: STAGES.replies,
    label: "The Reply Agent has facts it may state",
    state: (knowledge ?? 0) > 0 ? "ok" : "todo",
    detail:
      (knowledge ?? 0) > 0
        ? `${knowledge} document${knowledge === 1 ? "" : "s"} loaded.`
        : "None. The agent may not invent an answer, so every product question a prospect asks will be held for a human instead.",
    fix: (knowledge ?? 0) > 0 ? undefined : "Add a page to your knowledge base.",
    href: (knowledge ?? 0) > 0 ? undefined : "/app/knowledge",
  });

  // ---- Meetings ---------------------------------------------------------
  const [{ data: availability }, { data: feed }] = await Promise.all([
    db
      .from("availability")
      .select("working_hours, meeting_minutes, location")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .maybeSingle(),
    db
      .from("calendar_feeds")
      .select("url_host, status, last_synced_at, last_error, event_count")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);

  // The dangerous state is not "no calendar connected" but "a calendar the rep
  // believes is being read and is not": we keep honouring the last snapshot, it
  // gets older every day, and nothing else would ever say so.
  const staleHours = feed?.last_synced_at
    ? Math.floor((Date.now() - Date.parse(feed.last_synced_at)) / 3_600_000)
    : null;
  const feedStale = feed && (feed.status !== "ok" || (staleHours !== null && staleHours > 48));

  const own = env.CALENDAR_PROVIDER === "own";
  add({
    key: "calendar",
    stage: STAGES.calendar,
    label: "A prospect can be offered a time",
    state: "ok",
    detail: own
      ? feed && !feedStale
        ? "Using this product's own calendar, with your published calendar read alongside it, so anything already in your diary is protected."
        : "Using this product's own calendar. It knows about meetings booked here and nothing else — anything in your Google or Outlook diary has to be blocked out, or a prospect can pick a time you are not free."
      : `Using the ${env.CALENDAR_PROVIDER} calendar.`,
    fix: own && !availability ? "You have not set your hours, so the defaults are in use: 9 to 5, weekdays, 30 minutes." : undefined,
    href: own ? "/app/meetings" : undefined,
  });

  add({
    key: "calendar-feed",
    stage: STAGES.calendar,
    label: "Your own calendar is being read",
    state: !feed ? "todo" : feedStale ? "blocked" : "ok",
    detail: !feed
      ? "No calendar connected, so the only thing protecting your existing commitments is the time you block by hand."
      : feedStale
        ? `${feed.url_host} is not being read: ${feed.last_error ?? `last read ${staleHours} hours ago`}. The times from the last successful read are still avoided, but anything added since is not.`
        : `${feed.url_host}, ${feed.event_count} busy period${feed.event_count === 1 ? "" : "s"} read.`,
    fix: !feed
      ? "Paste the secret .ics address from Google or Outlook. No sign-in, read-only."
      : feedStale
        ? "Copy the secret address again — these links are rotated when sharing is turned off."
        : undefined,
    href: feed && !feedStale ? undefined : "/app/meetings",
  });

  add({
    key: "meeting-location",
    stage: STAGES.calendar,
    label: "A booked meeting says where it happens",
    state: availability?.location ? "ok" : "todo",
    detail: availability?.location
      ? "The invitation carries it."
      : "No location set, so the invitation tells the prospect when but not where, and somebody has to send a link by hand afterwards.",
    fix: availability?.location ? undefined : "Add a video link, phone number or address.",
    href: availability?.location ? undefined : "/app/meetings",
  });

  /*
   * Whether an email can actually be sent, not whether one is named.
   *
   * This asked `EMAIL_PROVIDER === "off"` — and `render.yaml` hard-codes that
   * variable to `resend`, so the check reported "both sides get a calendar
   * invitation" on a deployment with no API key, where no email can be sent at
   * all. A prospect books a time, nothing reaches their diary, and the one
   * screen built to find that says it is working.
   *
   * `trySend` swallows a failure on purpose — email is a notification channel
   * and must never retry a job that would re-send a LinkedIn message — so there
   * is no second chance to notice. This row is the only place it can be seen.
   *
   * Read off the provider the worker actually built rather than re-deriving the
   * condition from env, because two readings drift and the screen's is the one
   * somebody believes (rule 21). `createEmailProvider` is the one definition of
   * "can this deployment send an email".
   */
  const canEmail = ctx.email !== null;
  add({
    key: "invitations",
    stage: STAGES.calendar,
    label: "Calendar invitations can be sent",
    state: canEmail ? "ok" : "blocked",
    detail: canEmail
      ? "Both sides get a calendar invitation when a meeting is booked."
      : env.EMAIL_PROVIDER === "off"
        ? "Email is switched off here, so a booked meeting exists only in this app. The prospect gets no invitation and nothing appears in their diary — they will not turn up. The digest and the weekly report are silent for the same reason."
        : "No email can be sent, so a booked meeting exists only in this app and the prospect never hears. The digest and the weekly report are silent for the same reason. This is ours to fix rather than yours.",
    fix: canEmail ? undefined : "Nothing to change on your side. Raise it with support and we will fix it.",
    href: canEmail ? undefined : "/app/support",
    operator: canEmail
      ? undefined
      : env.EMAIL_PROVIDER === "off"
        ? 'EMAIL_PROVIDER is "off". Set it and a key on the worker.'
        : `EMAIL_PROVIDER is "${env.EMAIL_PROVIDER}" but no provider could be built. Set RESEND_API_KEY and EMAIL_FROM on the worker — both are needed; either one missing sends nothing.`,
  });

  return { checkedAt: new Date().toISOString(), checks };
}

/**
 * What the last run of the pacing loop decided, and what is waiting behind it.
 *
 * "Last ran two minutes ago" is reassuring and can be true of a loop that has
 * been declining for a week. The reason it declined is the useful half, and a
 * job already holding the id the loop would use is accepted silently by BullMQ
 * and never added — so one stuck invitation stops a campaign for ever while
 * every screen reports a healthy loop. The counts are the only place that
 * shows.
 */
function lastDecision(beat: { detail?: unknown } | undefined): string {
  const detail = beat?.detail && typeof beat.detail === "object" ? (beat.detail as Record<string, unknown>) : {};
  const parts: string[] = [];

  const decisions = Array.isArray(detail.decisions) ? detail.decisions : [];
  const reasons = decisions
    .map((d) => (d && typeof d === "object" ? (d as { reason?: unknown }).reason : null))
    .filter((r): r is string => typeof r === "string");
  if (reasons.length) parts.push(`Last run: ${reasons.join("; ")}.`);

  const queue = detail.queue && typeof detail.queue === "object" ? (detail.queue as Record<string, unknown>) : null;
  if (queue) {
    const failed = typeof queue.failed === "number" ? queue.failed : 0;
    const delayed = typeof queue.delayed === "number" ? queue.delayed : 0;
    const waiting = typeof queue.waiting === "number" ? queue.waiting : 0;
    if (failed || delayed || waiting) {
      parts.push(`Queue: ${waiting} waiting, ${delayed} delayed, ${failed} failed.`);
    }
    if (failed) {
      // The specific trap: the id is never reused while a failed job holds it.
      parts.push("A failed action keeps its slot, so the same person is never re-queued while it sits there.");
    }
  }

  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** Does the provider still have the account this workspace is holding? */
async function probeAccount(
  ctx: WorkerContext,
  providerAccountId: string | null,
): Promise<Omit<Check, "key" | "stage">> {
  if (!providerAccountId) {
    return {
      label: "The provider still has that account",
      state: "waiting",
      detail: "No provider account id stored yet, so there is nothing to ask about.",
    };
  }
  try {
    const health = await ctx.linkedin.getAccountHealth(providerAccountId);
    if (health === "ok") {
      return {
        label: "The provider still has that account",
        state: "ok",
        detail: "Asked the provider directly and it answered that the account is healthy.",
      };
    }
    return {
      label: "The provider still has that account",
      state: health === "warning" ? "waiting" : "blocked",
      detail: `The provider reports this account as "${health}".`,
      fix: health === "reauth_required" ? "Reconnect LinkedIn." : "Wait for the restriction to lift.",
      href: health === "reauth_required" ? "/app/team" : undefined,
    };
  } catch (err) {
    const gone = isAccountGone(err);
    return {
      label: "The provider still has that account",
      state: "blocked",
      detail: gone
        ? "The provider has no such account. The connection here is stale — this is what makes every campaign fail with nothing to show for it."
        : `Could not ask the provider: ${(err as { message?: string })?.message ?? "unknown error"}`,
      fix: gone ? "Reconnect LinkedIn." : undefined,
      href: gone ? "/app/team" : undefined,
    };
  }
}

/**
 * Does the provider hold a *different* account for this rep?
 *
 * Only a yes or no about this one rep's own accounts. It must never report
 * what else the provider holds: that list spans every workspace on the
 * deployment.
 */
async function probeReplacement(
  ctx: WorkerContext,
  userId: string,
  held: string | null,
): Promise<Omit<Check, "key" | "stage">> {
  let mine: Array<{ providerAccountId: string }>;
  try {
    const accounts = await ctx.linkedin.listAccounts();
    mine = accounts.filter((a) => a.reference === userId);
  } catch (err) {
    return {
      label: "The provider and this app agree about your account",
      state: "unknown",
      detail: `Could not ask the provider: ${(err as { message?: string })?.message ?? "unknown error"}`,
    };
  }

  if (mine.length === 0) {
    return {
      label: "The provider and this app agree about your account",
      state: "blocked",
      detail:
        "The provider has no LinkedIn account connected for you at all. If its own dashboard shows one as connected, it is not labelled with this user, which an administrator has to look at.",
      fix: "Connect LinkedIn again from the Team page.",
      href: "/app/team",
    };
  }

  const replacement = mine.find((a) => a.providerAccountId !== held);
  if (replacement && held) {
    return {
      label: "The provider and this app agree about your account",
      state: "blocked",
      detail:
        "The provider has a different account for you than the one stored here — this is what makes its dashboard show a healthy connection while this app says reconnect. Opening the Team page attaches the live one.",
      fix: "Open the Team page; it repairs this on arrival.",
      href: "/app/team",
    };
  }

  return {
    label: "The provider and this app agree about your account",
    state: "ok",
    detail: "The account stored here is the one the provider holds for you.",
  };
}

/**
 * A real search, for one person, run now.
 *
 * The only check here that costs anything, and the only one that would have
 * caught the two bugs that mattered: a route the subscription does not include,
 * and filters sent as words where LinkedIn takes ids.
 */
async function probeSearch(
  ctx: WorkerContext,
  providerAccountId: string | null,
  accountState: CheckState,
): Promise<Omit<Check, "key" | "stage">> {
  if (!providerAccountId || accountState === "blocked") {
    return {
      label: "Prospect search works",
      state: "waiting",
      detail: "Not attempted: the account has to be connected and live first.",
    };
  }
  try {
    const page = await ctx.linkedin.searchProspects({
      accountId: providerAccountId,
      query: { titles: ["Founder"], geographies: ["United States"] },
      limit: 1,
      tier: "classic",
    });
    const notes = page.filterNotes ?? [];
    return {
      label: "Prospect search works",
      state: page.items.length > 0 ? "ok" : "waiting",
      detail:
        page.items.length > 0
          ? "A test search for one founder in the United States returned a result."
          : "The search ran without error but matched nobody, which is unusual for so broad a query.",
      fix: notes.length ? notes.join(" ") : undefined,
    };
  } catch (err) {
    return {
      label: "Prospect search works",
      state: "blocked",
      detail: `A test search was refused: ${(err as { message?: string })?.message ?? "unknown error"}`,
      fix: isAccountGone(err) ? "Reconnect LinkedIn." : "The provider's own words are above — they name what to fix.",
      href: isAccountGone(err) ? "/app/team" : undefined,
    };
  }
}
