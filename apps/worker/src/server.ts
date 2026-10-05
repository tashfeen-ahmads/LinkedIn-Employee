import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { exchangeGoogleCode, exchangeMicrosoftCode, googleConsentUrl, microsoftConsentUrl } from "@le/calendar";
import { exchangeHubSpotCode, exchangeSalesforceCode, hubspotConsentUrl, salesforceConsentUrl } from "@le/crm";
import {
  StripeClient,
  normalizeSubscriptionStatus,
  planFromPriceLookupKey,
  verifyStripeWebhook,
} from "@le/billing";
import type { ConnectedAccount } from "@le/linkedin";
import { decryptJson, encryptJson } from "./crypto.js";
import { recordBeat } from "./heartbeat.js";
import type { MiddlewareHandler } from "hono";
import type { IntegrationKind } from "@le/db";
import { jobId } from "./queues.js";
import type { Queues } from "./queues.js";
import { queueReachable } from "./queues.js";
import { sendOneNow } from "./jobs/send-one.js";
import { runAgentTest } from "./jobs/agent-test.js";
import { writeWorkspacePitch } from "./jobs/write-pitch.js";
import { writeWorkspaceHooks } from "./jobs/write-hooks.js";
import { writeWorkspacePosts } from "./jobs/write-posts.js";
import { publishApprovedPosts } from "./jobs/publish-posts.js";
import { rewriteCampaignNotes } from "./jobs/rewrite-notes.js";
import type IORedis from "ioredis";
import type { WorkerContext } from "./context.js";
import { bookFromLink, readBookingPage } from "./jobs/book.js";
import { connectCalendarFeed, disconnectCalendarFeed } from "./jobs/calendar-feed.js";
import { reconcileAccount, recordObservedAccounts, recoverAccounts } from "./accounts.js";
import { runDiagnostics } from "./jobs/diagnostics.js";
import { eraseProspect, exportWorkspace } from "./jobs/retention.js";
import { inviteEmail, verifyUnsubscribeToken } from "@le/email";
import { trySend } from "./email.js";
import { sendAccountEmails } from "./jobs/lifecycle.js";
import { isPlatformAdmin, requestAnnouncementSend, saveAnnouncement, sendAnnouncementTest } from "./jobs/announcements.js";
import { collectIssues, recentFailures, type QueueCounts } from "./jobs/issues.js";
import { recordEvent } from "./context.js";

const AgentTestRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  agentId: z.string().uuid(),
  prospectId: z.string().uuid().optional(),
  // Typed into a form when no real prospect is picked, so every field is
  // capped: this goes straight into a prompt.
  subject: z
    .object({
      firstName: z.string().max(80),
      lastName: z.string().max(80).nullish(),
      company: z.string().max(120).nullish(),
      title: z.string().max(160).nullish(),
      headline: z.string().max(300).nullish(),
      location: z.string().max(120).nullish(),
      linkedinUrl: z.string().max(300).nullish(),
    })
    .optional(),
});

/** Just "who is asking, about which workspace" — the whole body some routes need. */
const MembershipRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

const WritePostsRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  // What the person asked to change. Capped because it is typed into a box and
  // goes straight into a prompt.
  instruction: z.string().max(2000).optional(),
  // Which business speaks, for a workspace that runs more than one. Absent is
  // the workspace's first, which is every workspace that has only ever had one.
  businessProfileId: z.string().uuid().optional(),
});

const WritePitchRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  // What the person asked to change. Capped because it is typed into a box and
  // goes straight into a prompt.
  instruction: z.string().max(2000).optional(),
  // Which agent's set to write. Absent is the workspace's own, which is what
  // every caller meant before an agent could own copy.
  agentId: z.string().uuid().optional(),
});

const RewriteNotesRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  campaignId: z.string().uuid(),
});

const StrategyRequest = z
  .object({
    workspaceId: z.string().uuid(),
    userId: z.string().uuid(),
    websiteUrl: z.string().optional(),
    linkedinCompanyUrl: z.string().optional(),
    description: z.string().optional(),
    existingCustomers: z.array(z.string()).optional(),
    /** Add to the strategies this workspace has rather than writing its first. */
    expand: z.boolean().optional(),
    /**
     * Which business to add them to, for a workspace running several.
     *
     * Only ever read through `loadBusinessProfile`, which scopes by workspace
     * as well as by id — the worker holds the service role, so an id taken
     * from a request and trusted alone is one mistake away from writing
     * strategies into another tenant's business.
     */
    businessProfileId: z.string().uuid().optional(),
  })
  // The agent refuses to invent an ICP from nothing, so a request carrying
  // nothing would enqueue a job that fails three times and dies unseen. Reject
  // it here, where the caller can still be told.
  //
  // An expanding run is exempt: it works from the business profile and the
  // strategies already stored, which is more material than a first run ever
  // has, and requiring the website again would make "write me four more" fail
  // for anybody who onboarded with a description.
  .refine(
    (input) =>
      Boolean(input.expand || input.websiteUrl || input.linkedinCompanyUrl || input.description),
    { message: "need a website, a LinkedIn page, or a description to work from" },
  );

const TargetingRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  linkedinAccountId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
  /**
   * Continue this campaign's list instead of starting a new one. The job reads
   * the profile and the account off the campaign's own row rather than trusting
   * the two above, so a caller cannot graft one campaign's search onto another
   * profile's list.
   */
  campaignId: z.string().uuid().optional(),
});

const CampaignTickRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  campaignId: z.string().uuid(),
});

const SendOneRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  campaignId: z.string().uuid(),
});

const SendReplyRequest = z.object({
  workspaceId: z.string().uuid(),
  // Who is sending it. Every other /jobs route names the caller and checks
  // their membership; this one did not, and it is the route that puts a
  // message in front of a real person under a rep's own name.
  userId: z.string().uuid(),
  draftId: z.string().uuid(),
});

/** The person who just arrived. The web app takes this id from their session, never a form. */
const AccountEmailsRequest = z.object({ userId: z.string().uuid() });

// The token is the whole authorisation; the length cap stops a pasted novel
// becoming an HMAC computation.
const UnsubscribeRequest = z.object({ token: z.string().min(10).max(300) });

const AnnouncementRequest = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("save"),
    userId: z.string().uuid(),
    id: z.string().uuid().optional(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10_000),
    // Both or neither: a label with nowhere to go is a dead button.
    ctaLabel: z.string().trim().max(60).nullable(),
    ctaUrl: z
      .string()
      .trim()
      .max(2000)
      .regex(/^https:\/\//, "must start with https://")
      .nullable(),
  }),
  z.object({ op: z.literal("test"), userId: z.string().uuid(), id: z.string().uuid() }),
  z.object({
    op: z.literal("send"),
    userId: z.string().uuid(),
    id: z.string().uuid(),
    // The form's checkbox, carried through rather than trusted to the page:
    // "send to everybody" is not a request that can arrive by accident.
    confirm: z.literal(true),
  }),
]);

const LinkRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

// The token is the whole authorisation, so it is validated like one: a length
// floor rejects a truncated paste before it becomes a database lookup, and
// nothing here accepts a workspace or a user id from the caller.
const BookingPageRequest = z.object({ token: z.string().min(20).max(200) });

const BookingConfirmRequest = BookingPageRequest.extend({
  startsAt: z.string().datetime(),
  name: z.string().trim().min(1).max(120),
  // Checked because it is what the calendar invitation is addressed to. A
  // booking whose invitation bounces is a meeting the prospect never sees.
  email: z.string().trim().email().max(320),
});

// `url: null` disconnects. A separate route for that would be one more thing
// to authorise the same way.
const CalendarFeedRequest = LinkRequest.extend({
  url: z.string().trim().min(1).max(2000).nullable(),
});

const InviteEmailRequest = LinkRequest.extend({
  invitationId: z.string().uuid(),
});

const EraseRequest = LinkRequest.extend({
  prospectId: z.string().uuid(),
  reason: z.string().min(1).max(200),
});

const ExportRequest = LinkRequest;

const CheckoutRequest = LinkRequest.extend({
  plan: z.enum(["solo", "pro", "teams"]),
  seats: z.number().int().min(1).max(100).default(1),
  email: z.string().email().optional(),
});

/**
 * Verifies the named user really belongs to the named workspace.
 *
 * The shared secret already proves the caller is the web app, which derives
 * both ids from a signed-in session. This is the second lock: if that secret
 * ever leaks, an attacker still cannot bind their own HubSpot portal or
 * calendar to a workspace they are not a member of, which would otherwise
 * redirect every prospect conversation in that workspace to them.
 */
async function assertMembership(
  db: WorkerContext["db"],
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await db
    .from("memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Signed state so a callback cannot be used to bind somebody else's account.
 *
 * Used by the calendar OAuth flow and by the LinkedIn connect return trip.
 * AES-GCM with the deployment's own key, so it is unforgeable rather than
 * merely opaque, and it carries the moment it was minted so a stale one can be
 * refused.
 */
function encodeState(workspaceId: string, userId: string, key: string): string {
  return encryptJson({ workspaceId, userId, issuedAt: Date.now() }, key);
}

/**
 * Inbound webhook surface. Unipile posts here when a prospect replies; we
 * verify the signature, resolve the account, and hand off to the queue so the
 * HTTP response stays fast and delivery is retried by BullMQ, not the provider.
 */
export function createServer(ctx: WorkerContext, queues: Queues, connection?: IORedis): Hono {
  const app = new Hono();

  /**
   * Whether this process is serving, and what it can see from here.
   *
   * It used to answer `{ ok: true }` without looking at anything, which is how
   * an afternoon went: the process up, the platform reporting the service Live,
   * the HTTP API answering every request — and every job queued since the
   * morning unconsumed, because the queue was unreachable and a client that
   * retries for ever reports that as nothing at all.
   *
   * The queue's state is reported in the body and **not** in the status code,
   * which is a correction of the obvious fix. The platform reads this route to
   * decide whether a deployment may go live: answering 503 on an unreachable
   * queue means the build that would explain the problem is the one build that
   * can never be promoted, and the deployment keeps serving the older code that
   * says nothing. A restart does not reach a Redis that is not there anyway —
   * ioredis reconnects on its own — so the 503 buys nothing and costs the
   * diagnosis. Being wrong about this is worse than being quiet about it.
   *
   * `/jobs/*` still refuses outright, because that is a different question:
   * not "may I run" but "may I promise to do this piece of work".
   */
  app.get("/health", async (c) => {
    if (!connection) return c.json({ ok: true, queue: "unchecked" });
    const queue = await queueReachable(connection);
    return c.json({ ok: true, queue: queue ? "reachable" : "unreachable" });
  });

  /**
   * Everything under /jobs and /auth/*\/link is a privileged internal API: the
   * caller names the workspace and user it is acting for, so without this check
   * anyone who can reach the worker could enqueue outreach for any tenant or
   * start an OAuth flow bound to someone else's workspace.
   *
   * The web app is the only legitimate caller and shares this secret with it.
   * Provider callbacks are deliberately not covered: the OAuth callbacks carry
   * their own signed state, and the Unipile webhook its own signature.
   */
  app.use("/jobs/*", requireInternalAuth(ctx.env.INTERNAL_API_SECRET));

  /**
   * Refuses to accept work the queue cannot hold.
   *
   * Every route below ends in `queue.add`, and against an unreachable Redis
   * that call does not fail — the client keeps the command and waits for a
   * connection that is not coming. The request hangs, the caller times out, and
   * what the person sees is a button that did nothing, which is the same thing
   * they see when everything is fine and the work is merely paced. Accepting a
   * job we cannot store and answering "queued" is the worse lie of the two.
   */
  app.use("/jobs/*", async (c, next) => {
    if (connection && !(await queueReachable(connection))) {
      return c.json({ error: "the job queue is unreachable, so nothing can be queued" }, 503);
    }
    await next();
  });
  app.use("/auth/:provider/link", requireInternalAuth(ctx.env.INTERNAL_API_SECRET));

  // Job entry points used by the web app. These enqueue and return; nothing
  // that touches LinkedIn or Claude happens on the request thread.
  app.post("/jobs/strategy", async (c) => {
    const parsed = StrategyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    // Recorded before the job is queued, because the minutes in between are
    // exactly when nobody knows anything. Onboarding's only output is written
    // by the agent, so until it lands the dashboard has no evidence the person
    // did their part -- and told one tester for twenty-one minutes that they
    // had not said what they sell, with a button inviting them to do it again.
    //
    // Never at the cost of the run itself: a failure to write the note must not
    // 500 a request whose job was accepted, or the caller submits again and the
    // agent runs twice. Worst case the screen is as uninformative as it was
    // before, which is not worth a duplicate campaign.
    try {
      await recordEvent(ctx.db, {
        workspaceId: parsed.data.workspaceId,
        name: "strategy.queued",
        actorUserId: parsed.data.userId,
        subjectType: "workspace",
        subjectId: parsed.data.workspaceId,
        payload: { websiteUrl: parsed.data.websiteUrl ?? null },
      });
    } catch (err) {
      console.error("could not record strategy.queued", err);
    }
    await queues.strategy.add("strategy", parsed.data);
    return c.json({ queued: true });
  });

  /*
   * Email to the product's own users. Under /email rather than /jobs because
   * none of it needs the queue: a welcome, an unsubscribe and an operator's
   * note must not be refused because Redis is having a bad minute, and the
   * /jobs/* guard refuses exactly that. Same shared secret, applied here.
   */
  app.use("/email/*", requireInternalAuth(ctx.env.INTERNAL_API_SECRET));

  // Signup, email confirmation and onboarding all call this; every email in it
  // is claimed once per person, so three calls send each one once.
  app.post("/email/account", async (c) => {
    const parsed = AccountEmailsRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    return c.json(await sendAccountEmails(ctx, parsed.data.userId));
  });

  // One-click unsubscribe, from the link in the footer or a mailbox provider's
  // RFC 8058 POST. Marketing only: transactional email is not touched.
  app.post("/email/unsubscribe", async (c) => {
    const parsed = UnsubscribeRequest.safeParse(await c.req.json().catch(() => null));
    const userId = parsed.success ? verifyUnsubscribeToken(parsed.data.token, ctx.env.INTERNAL_API_SECRET) : null;
    if (!userId) return c.json({ error: "That unsubscribe link is not valid." }, 400);
    const { error } = await ctx.db
      .from("profiles")
      .update({ marketing_opt_out_at: new Date().toISOString() })
      .eq("id", userId)
      .is("marketing_opt_out_at", null);
    if (error) return c.json({ error: "We could not record that just now. Please try the link again." }, 500);
    return c.json({ ok: true });
  });

  /*
   * The operator's announcements. Platform-scoped rather than workspace-scoped,
   * so not under /jobs (whose second lock is workspace membership): the second
   * lock here is `platform_admins`, checked by every op in announcements.ts.
   */
  app.use("/admin/*", requireInternalAuth(ctx.env.INTERNAL_API_SECRET));
  /*
   * Everything wrong across the deployment, for the operator console's Issues
   * tab. The second lock is `platform_admins`, exactly as announcements: the
   * internal secret proves the web app is asking, this proves who it is asking
   * for.
   */
  app.post("/admin/issues", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { userId?: string } | null;
    if (!body?.userId || !(await isPlatformAdmin(ctx.db, body.userId))) {
      return c.json({ error: "not a platform admin" }, 403);
    }
    return c.json({ issues: await collectIssues(ctx, new Date(), await failedJobCounts(queues)), at: new Date().toISOString() });
  });

  app.post("/admin/announcements", async (c) => {
    const parsed = AnnouncementRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, 400);
    }
    const req = parsed.data;
    if (req.op === "save") {
      if (Boolean(req.ctaLabel) !== Boolean(req.ctaUrl)) {
        return c.json({ error: "A button needs both a label and a link, or neither." }, 400);
      }
      const saved = await saveAnnouncement(ctx, {
        userId: req.userId,
        id: req.id,
        subject: req.subject,
        body: req.body,
        ctaLabel: req.ctaLabel || null,
        ctaUrl: req.ctaUrl || null,
      });
      return saved.ok ? c.json({ id: saved.id }) : c.json({ error: saved.error }, 400);
    }
    if (req.op === "test") {
      const sent = await sendAnnouncementTest(ctx, req);
      return sent.ok ? c.json({ to: sent.to }) : c.json({ error: sent.error }, 400);
    }
    // Asked before claiming: a claim whose delivery cannot be queued leaves a
    // button that now refuses to send and an announcement nobody received
    // until the hourly run notices, which needs the queue too.
    if (connection && !(await queueReachable(connection))) {
      return c.json({ error: "the job queue is unreachable, so nothing can be queued" }, 503);
    }
    const claimed = await requestAnnouncementSend(ctx, req);
    if (!claimed.ok) return c.json({ error: claimed.error }, 409);
    // The id makes a second add a no-op, and the hourly run resumes it if this
    // job never runs. jobId(), never a template literal: BullMQ rejects ":".
    await queues.digest.add("announcement", { announcementId: req.id }, { jobId: jobId("announcement", req.id) });
    return c.json({ queued: true });
  });

  // Every precondition between signing up and a booked meeting, checked live.
  // Read-only, and scoped to the caller's own workspace and account: it reports
  // whether this rep's LinkedIn is reachable, never what other accounts the
  // provider holds.
  // Attaching a published calendar. The URL is validated and fetched here
  // before it is stored -- a rep who pastes the wrong link should find out
  // while they are still looking at the page, not from a nightly job.
  app.post("/jobs/calendar-feed", async (c) => {
    const parsed = CalendarFeedRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    if (parsed.data.url === null) {
      await disconnectCalendarFeed(ctx, parsed.data);
      return c.json({ ok: true });
    }
    const result = await connectCalendarFeed(ctx, { ...parsed.data, url: parsed.data.url });
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.post("/jobs/diagnostics", async (c) => {
    const parsed = LinkRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    return c.json(await runDiagnostics(ctx, parsed.data));
  });

  // The booking page, which is opened by a prospect who is not signed in.
  //
  // Deliberately outside /jobs/*: it is reached by the web app on behalf of
  // somebody holding a link, not by an authenticated rep. The token in the body
  // is the entire authorisation and is checked on every call — these two never
  // take a workspace id from the caller, because a caller who could name one
  // could read another company's prospects.
  app.post("/booking/page", async (c) => {
    const parsed = BookingPageRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    return c.json(await readBookingPage(ctx, parsed.data.token));
  });

  app.post("/booking/confirm", async (c) => {
    const parsed = BookingConfirmRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Please check the name and email address." }, 400);
    const result = await bookFromLink(ctx, parsed.data);
    return result.ok ? c.json(result) : c.json({ error: result.error ?? "That could not be booked." }, 409);
  });

  app.post("/jobs/targeting", async (c) => {
    const parsed = TargetingRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    // Recorded before the job is queued, and for the same reason the Strategy
    // Agent's is: without it, "the request never reached the worker" and "the
    // worker took it and died" are the same blank screen. A night was spent on
    // exactly that ambiguity -- a button pressed, no banner, no event, nothing
    // to tell the two apart.
    //
    // Never at the cost of the run: a failure to write the note must not 500 a
    // request whose job was accepted, or the caller presses again and two
    // agents search.
    try {
      await recordEvent(ctx.db, {
        workspaceId: parsed.data.workspaceId,
        name: "targeting.queued",
        actorUserId: parsed.data.userId,
        subjectType: "customer_profile",
        subjectId: parsed.data.customerProfileId,
        payload: { limit: parsed.data.limit ?? null, campaignId: parsed.data.campaignId ?? null },
      });
    } catch (err) {
      console.error("could not record targeting.queued", err);
    }
    await queues.targeting.add("targeting", parsed.data);
    return c.json({ queued: true });
  });

  /**
   * Runs the pacing loop now, rather than within the next five minutes.
   *
   * Launching a campaign used to touch nothing but the database: the row went
   * to `running` and a background loop was trusted to notice. So the one action
   * in this product that most needs the worker was the only one that never
   * spoke to it — and a worker that was not running produced no error, no
   * banner and no clue, just a page that looked exactly as it had before. The
   * first live launch went that way.
   *
   * This makes launching a round trip. The tick it queues is the same one the
   * schedule queues, so a failure here costs nothing but the wait; what it buys
   * is that the person pressing Launch finds out immediately whether anything
   * is listening.
   */
  app.post("/jobs/campaign-tick", async (c) => {
    const parsed = CampaignTickRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    // The loop reads every running campaign itself, so the id names the reason
    // rather than the work. Deduplicated per campaign per minute: a rep
    // pressing Launch, Pause and Launch again should not queue three sweeps.
    await queues.campaignTick.add(
      "tick",
      { workspaceId: parsed.data.workspaceId, campaignId: parsed.data.campaignId },
      { jobId: jobId("launch", parsed.data.campaignId, Math.floor(Date.now() / 60_000)) },
    );
    return c.json({ queued: true });
  });

  /**
   * Sends the next queued invitation now, and answers with what happened.
   *
   * Not a queue route despite living here: the whole point is that the caller
   * waits for the outcome. Every other way of finding out whether a real
   * invitation can leave this deployment costs a quarter of an hour and answers
   * with a blank page, which is how eight days went by without one.
   */
  app.post("/jobs/send-one", async (c) => {
    const parsed = SendOneRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    const result = await sendOneNow(ctx, {
      workspaceId: parsed.data.workspaceId,
      campaignId: parsed.data.campaignId,
    });
    // 200 either way: "the limiter is holding this" is a successful answer to
    // the question asked, and the caller renders `detail` regardless.
    return c.json(result);
  });

  // The pitch, written on the request thread and handed back.
  //
  // Not queued: a queued run leaves whoever pressed the button looking at an
  // unchanged page, which is what a button that does nothing also looks like.
  // The model takes a few seconds and its output is the entire point of the
  // click.
  app.post("/jobs/write-pitch", async (c) => {
    const parsed = WritePitchRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    const result = await writeWorkspacePitch(ctx, parsed.data);
    // 200 either way, as /jobs/send-one does: "you have not told us what you
    // sell yet" is a correct answer to the question, and the caller renders
    // the sentence rather than translating a status code into a shrug.
    return c.json(result);
  });

  /*
   * Drafts for the rep's own profile. Same shape and same reason for being
   * synchronous: the drafts are the whole point of the click.
   */
  app.post("/jobs/write-posts", async (c) => {
    const parsed = WritePostsRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    // 200 either way, as /jobs/write-pitch does: "tell us what you do first" is
    // a correct answer to the question, and the caller renders the sentence
    // rather than turning a status code into a shrug.
    return c.json(await writeWorkspacePosts(ctx, parsed.data));
  });

  /*
   * Publish whatever is approved and due, now.
   *
   * The quarter-hourly sweep does this on its own; this is what Approve calls,
   * for rule 21's reason — the action that most needs the worker must not be the
   * one that only sets a row and trusts the schedule to notice. A post approved
   * at 10:02 going out at 10:15 is a product that looks broken for thirteen
   * minutes.
   *
   * It takes no post id on purpose. The sweep reads every approved row for the
   * caller's own workspace and `mayPublish` decides each one, so a request
   * cannot make a particular post go — including one somebody else's approval
   * is still pending on.
   */
  app.post("/jobs/publish-posts", async (c) => {
    const parsed = MembershipRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    return c.json(await publishApprovedPosts(ctx, new Date(), 25, parsed.data.workspaceId));
  });

  // The openers. Same shape as /jobs/write-pitch, and same reason for being
  // synchronous: its output is the entire point of the click.
  app.post("/jobs/write-hooks", async (c) => {
    const parsed = WritePitchRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    const result = await writeWorkspaceHooks(ctx, parsed.data);
    return c.json(result);
  });

  /*
   * Write a campaign's connection notes again, for the people not yet invited.
   *
   * Synchronous for the same reason the writers above are: its output is the
   * whole point of the click, and the page it returns to is the page showing
   * the notes. 200 either way — "nobody on this campaign is still waiting" is
   * a correct answer to the question.
   */
  app.post("/jobs/rewrite-notes", async (c) => {
    const parsed = RewriteNotesRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    return c.json(await rewriteCampaignNotes(ctx, parsed.data));
  });

  /*
   * Run an agent against one prospect and hand back what it would send.
   *
   * Synchronous for the same reason /jobs/write-pitch is: the output is the
   * whole point of the click, and an answer delivered by a background job is an
   * answer nobody waits for. 200 either way — "approve a strategy first" is a
   * correct answer to the question, and the caller renders the sentence rather
   * than turning a status code into a shrug.
   */
  app.post("/jobs/agent-test", async (c) => {
    const parsed = AgentTestRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }
    return c.json(await runAgentTest(ctx, parsed.data));
  });

  app.post("/jobs/send-reply", async (c) => {
    const parsed = SendReplyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    // Only a draft a human already approved may be sent, and only within its
    // own workspace: the id alone is not authority to message someone.
    const { data: draft } = await ctx.db
      .from("reply_drafts")
      .select("id, conversation_id, status")
      .eq("id", parsed.data.draftId)
      .eq("workspace_id", parsed.data.workspaceId)
      .maybeSingle();
    if (!draft || draft.status !== "approved") return c.json({ error: "draft is not approved" }, 409);

    await queues.linkedinAction.add(
      "reply",
      {
        kind: "reply",
        workspaceId: parsed.data.workspaceId,
        conversationId: draft.conversation_id,
        draftId: draft.id,
      },
      { jobId: jobId("reply", draft.id) },
    );
    return c.json({ queued: true });
  });

  // Starts the provider's hosted login. The rep authenticates on the
  // provider's page, so no LinkedIn credential ever reaches this service.
  app.post("/auth/linkedin/link", async (c) => {
    const parsed = LinkRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);

    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    // An error from the provider used to escape this handler, which Hono turns
    // into a bare 500. The rep then saw "the background service had a problem"
    // for a wrong access token, a wrong DSN and a provider outage alike — three
    // different things to do about it, and no way to tell which.
    let link;
    try {
      link = await ctx.linkedin.createHostedAuthLink({
        userId: parsed.data.userId,
        /*
         * The return trip carries who started it, so it cannot depend on a
         * session surviving.
         *
         * It used to land straight on an app page, and that page read the
         * signed-in session to know whose account to attach. Which means the
         * whole connection hinged on a cookie still being there several
         * minutes later, on the host the redirect happens to name — and when
         * it was not, the rep landed on /login, the claim never ran, and the
         * row sat `connecting` holding nothing while the account worked
         * perfectly at the provider. Reconnecting produced the same dead end,
         * every time, because pressing the button again changes none of that.
         *
         * So the success URL comes back *here*, carrying a token this worker
         * minted and only this worker can read. Identity comes out of the
         * token rather than out of a cookie. It is not weaker than the session
         * it replaces: it is encrypted and authenticated with the deployment's
         * own key, it expires in an hour, and everything it unlocks is still
         * guarded by `claimAccount` — the provider is asked rather than
         * believed, an account another row holds is refused, and only a row
         * this rep's own Connect press left waiting can be filled.
         *
         * Without a key to mint one, the old behaviour stands rather than the
         * connection being refused: a deployment missing CREDENTIALS_KEY keeps
         * exactly what it had.
         */
        successUrl: claimReturnUrl(ctx, parsed.data.workspaceId, parsed.data.userId),
        failureUrl: claimFailureUrl(ctx, parsed.data.workspaceId, parsed.data.userId),
        // The redirect tells the rep's browser it worked. This tells us, and
        // until it arrives the account has no provider id, so every job skips it.
        notifyUrl: `${ctx.env.WORKER_URL}/webhooks/unipile/accounts`,
      });
    } catch (err) {
      // The provider's own body goes to the log, never to the browser: it is
      // written for whoever holds the credentials, not for the rep. That was
      // already the intention here and `describeProviderFailure` broke it —
      // it named the vendor and the credential in the text this returns.
      console.error("hosted auth link failed", operatorProviderFailure(err), err);
      return c.json({ error: describeProviderFailure(err) }, 502);
    }

    /*
     * The account row takes what onboarding was already told.
     *
     * Sending hours and the Sales Navigator tick are answered at signup, when
     * no account exists to hold them — they wait on `workspaces.onboarding`
     * (migration 0038) and land here, the first moment there is a row. Without
     * this the answers are collected and then quietly ignored, and the rep is
     * asked for them a second time on the profile screen: exactly the
     * re-asking onboarding was rebuilt to stop.
     *
     * Read fresh rather than trusted from the request: these decide when an
     * account may act and which search tier it gets, and a request is not
     * where either belongs.
     */
    const { data: ws } = await ctx.db
      .from("workspaces")
      .select("onboarding")
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();
    const answers = (ws?.onboarding ?? null) as
      | { workingHours?: { start: number; end: number; days: number[] } | null; hasSalesNavigator?: boolean }
      | null;

    /*
     * Pressing Connect never takes a working account off the air.
     *
     * Every press used to write `connecting`, so a rep who pressed Reconnect
     * on a healthy account and then mistyped their LinkedIn password was left
     * with a row every job skips and a screen saying "connecting" — a working
     * account broken by trying to repair it. Only a row that holds nothing
     * usable is moved to `connecting`; one that already has an account keeps
     * its status, and `claimAccount` attaches the new sign-in to it if one
     * comes back.
     */
    const { data: existing } = await ctx.db
      .from("linkedin_accounts")
      .select("status")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", parsed.data.userId)
      .maybeSingle();
    const keepStatus = Boolean(existing && !RESTARTABLE_STATUSES.includes(existing.status));

    await ctx.db.from("linkedin_accounts").upsert(
      {
        workspace_id: parsed.data.workspaceId,
        user_id: parsed.data.userId,
        provider: ctx.linkedin.name,
        ...(keepStatus ? {} : { status: "connecting" as const }),
        // Only when onboarding actually answered. Spreading an absent value
        // would overwrite a window the rep has since edited on their profile
        // with a default nobody chose — a reconnect must not silently reset
        // the hours (rule 8's habit: repair never makes things worse).
        ...(answers?.workingHours ? { working_hours: answers.workingHours as never } : {}),
        ...(typeof answers?.hasSalesNavigator === "boolean"
          ? { has_sales_navigator: answers.hasSalesNavigator }
          : {}),
      },
      { onConflict: "workspace_id,user_id" },
    );

    return c.json({ url: link.url, expiresAt: link.expiresAt });
  });

  app.post("/webhooks/unipile/messages", async (c) => {
    const body = await c.req.text();
    // Two credentials, because Unipile has two schemes (see `verifyDelivery`):
    // v2 signs in `unipile-signature`, v1 carries a shared secret in a header
    // configured on the webhook itself.
    const { signature, authHeader } = webhookCredentials(c);

    let messages;
    try {
      messages = ctx.linkedin.parseWebhook({ body, signature, authHeader });
    } catch (err) {
      await recordBeat(ctx.db, "webhook:messages", {
        at: new Date().toISOString(),
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        // "A credential arrived", either kind. Kept under this name because
        // the readers (rule 46) split refusals on it: none at all means the
        // webhook is configured without one, one that does not verify means
        // the secret differs between the two sides.
        hadSignature: Boolean(signature || authHeader),
        credential: signature ? "signature" : authHeader ? "header" : null,
        bytes: body.length,
      });
      console.error("rejected webhook", err);
      return c.json({ error: "invalid signature" }, 401);
    }

    for (const message of messages) {
      const { data: account } = await ctx.db
        .from("linkedin_accounts")
        .select("id, workspace_id")
        .eq("provider_account_id", message.providerAccountId)
        .maybeSingle();
      if (!account) continue;

      await queues.inbound.add(
        "inbound",
        {
          workspaceId: account.workspace_id,
          linkedinAccountId: account.id,
          providerChatId: message.providerChatId,
          providerMessageId: message.providerMessageId,
          fromProviderId: message.fromProviderId,
          text: message.text,
          receivedAt: message.receivedAt,
        },
        // Provider redelivery is normal; the job id makes it a no-op.
        { jobId: jobId("inbound", message.providerMessageId) },
      );
    }

    return c.json({ received: messages.length });
  });

  /**
   * The provider telling us a rep finished signing in.
   *
   * This is the step that makes a connected account real. The link flow writes
   * a row with status `connecting` and no provider id, and every job checks for
   * both — so without this the rep completes the hosted login, sees a success
   * redirect, and nothing ever sends from their account. Not one invitation,
   * with no error anywhere to explain it.
   */
  app.post("/webhooks/unipile/accounts", async (c) => {
    const body = await c.req.text();
    // Two credentials, because Unipile has two schemes (see `verifyDelivery`):
    // v2 signs in `unipile-signature`, v1 carries a shared secret in a header
    // configured on the webhook itself.
    const { signature, authHeader } = webhookCredentials(c);

    let accounts;
    try {
      accounts = ctx.linkedin.parseAccountWebhook({ body, signature, authHeader });
    } catch (err) {
      /*
       * A rejected delivery leaves a mark, and the absence of one is the whole
       * point.
       *
       * This handler used to answer 401 and write nothing anywhere. So "the
       * provider never called us" and "the provider called and we refused it"
       * were the same observation from every screen in the product — and they
       * need opposite things done about them: a wrong WORKER_URL in the
       * provider's webhook config, or a webhook secret that does not match the
       * one on this host. Four connection attempts were spent guessing between
       * them, and the answer was never written down.
       *
       * The signature itself is never recorded, only whether one arrived: it is
       * the credential the check is made of.
       */
      await recordBeat(ctx.db, "webhook:accounts", {
        at: new Date().toISOString(),
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        // "A credential arrived", either kind. Kept under this name because
        // the readers (rule 46) split refusals on it: none at all means the
        // webhook is configured without one, one that does not verify means
        // the secret differs between the two sides.
        hadSignature: Boolean(signature || authHeader),
        credential: signature ? "signature" : authHeader ? "header" : null,
        bytes: body.length,
      });
      console.error("rejected account webhook", err);

      /*
       * A delivery we cannot verify is still a doorbell.
       *
       * Not a key: not one byte of that body is read, and the answer is still
       * 401. But refusing it and learning nothing is what left this deployment
       * holding a dead account id for days at a time. The provider does not
       * sign the `notify_url` it is handed on a hosted auth link, so the one
       * delivery that says "a rep just connected" can never verify — and the
       * only other path to binding was a person loading an authenticated page
       * before the nightly sweep. Miss that, and the row sits `connecting`
       * while the account works perfectly at the provider.
       *
       * So the ring makes us *ask*. `recoverAccounts` pulls the list over our
       * own authenticated call and matches only accounts carrying the rep's
       * own user id — rule 8's binding rule, untouched. Nothing the caller
       * sent can influence what is bound, which is what makes this safe to run
       * for an unauthenticated request.
       *
       * Debounced, because the endpoint is open: without it, anyone who can
       * POST here could make us call the provider as fast as they like.
       */
      void pullAfterUnverifiedNotice(ctx);
      return c.json({ error: "invalid signature" }, 401);
    }

    const bound = await bindAccounts(ctx, accounts);
    // Accepted deliveries are stamped too. `received: 1, bound: 0` is a real
    // state — the delivery verified and named a rep this workspace does not
    // have — and it is invisible without this.
    await recordBeat(ctx.db, "webhook:accounts", {
      at: new Date().toISOString(),
      ok: true,
      received: accounts.length,
      bound,
      referenceShape: accounts.map((a) => shapeOf(a.reference)),
    });
    return c.json({ received: accounts.length, bound });
  });

  /**
   * Confirm a connection by asking the provider, rather than waiting to be told.
   *
   * The hosted flow's notification is one delivery. Rejected once — a signature
   * mismatch, a restart, a webhook registered after the account was already
   * connected — and the row stays `connecting` forever while the account works
   * perfectly at the provider. The rep sees "sending is paused" and a Reconnect
   * button that runs the same flow to the same end.
   *
   * So the same binding is reachable by asking. Nothing here trusts the caller
   * about which account is whose: the provider's own `name` is the rep's user
   * id, exactly as the notification carries it.
   */
  /**
   * Claim the account the hosted flow just produced, by the id it hands back.
   *
   * The provider's success redirect carries `account_id`, and that turned out
   * to be the only reliable tie between a finished sign-in and the rep who
   * started it. Its accounts list returns `object`, `connection_params`,
   * `name`, `type`, `created_at`, `sources`, `id`, `groups` — and nothing
   * holding the identifier the hosted link was given. `name` is the LinkedIn
   * profile's display name. So matching by reference on the pull path could
   * never work, however it was spelled, and four connections were spent
   * discovering that from an error message instead of from the payload.
   *
   * This does not loosen rule 8, and the two checks are why. The redirect
   * lands in the browser of a rep who is signed in here, so the workspace and
   * user come from their session and never from the request. And an account is
   * only ever attached to a row that is *already waiting* for one — the row
   * this rep's own Connect press created — and never to a row that is working,
   * and never to an account another row already holds. A forged `account_id`
   * therefore buys nothing: it can only land somewhere its sender already had
   * a pending connection of their own.
   */
  app.post("/jobs/linkedin-claim", async (c) => {
    const Claim = LinkRequest.extend({ accountId: z.string().min(1) });
    const parsed = Claim.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    const { workspaceId, userId, accountId } = parsed.data;
    if (!(await assertMembership(ctx.db, workspaceId, userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    const result = await claimAccount(ctx, { workspaceId, userId, accountId });
    if (result.status === "provider_error") return c.json({ error: result.reason }, 502);
    if (!result.claimed) return c.json({ claimed: false, reason: result.reason });
    return c.json({ claimed: true, status: result.accountStatus });
  });

  /**
   * Where the hosted flow lands, and the reason connecting now works first time.
   *
   * This is a public GET because the provider redirects a browser here, so it
   * proves nothing by arriving. Everything it is allowed to do comes out of
   * `claim`, which this worker minted with its own key and nobody else can
   * forge or alter. A request without one, with a stale one, or with one that
   * does not decrypt is sent to the app with an error rather than being told
   * anything about what exists here.
   *
   * It never renders. Whatever happened, the rep ends up on the page they
   * expect, with the outcome in the query string — including the refusals,
   * because "we could not attach it" shown on a screen is the difference
   * between a two-minute fix and the three days this cost.
   */
  /*
   * Where a LinkedIn sign-in that did not work comes back to.
   *
   * Public for the same reason `/auth/linkedin/done` is — the provider
   * redirects a browser here — and it trusts nothing that arrives except the
   * token this worker minted. A forged or stale token records nothing and is
   * sent on with the same sentence, so the route cannot be used to write
   * events into somebody else's workspace or to learn which tokens exist.
   *
   * What the provider appended to the URL is recorded, minus the token: it is
   * the only clue to *why* it failed, and the first time anybody looked there
   * was nothing to read.
   */
  app.get("/auth/linkedin/failed", async (c) => {
    const back = () =>
      c.redirect(`${ctx.env.APP_URL}/app/profile?error=${encodeURIComponent(LINKEDIN_SIGN_IN_FAILED)}#team`, 302);

    const claim = c.req.query("claim");
    if (!claim || !ctx.env.CREDENTIALS_KEY) return back();

    let who: { workspaceId: string; userId: string; issuedAt: number };
    try {
      who = decryptState(claim, ctx.env.CREDENTIALS_KEY);
    } catch {
      return back();
    }
    if (Date.now() - who.issuedAt > CLAIM_TOKEN_TTL_MS) return back();

    const provider: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.query())) {
      if (key === "claim") continue;
      provider[key] = String(value).slice(0, 300);
    }

    await recordEvent(ctx.db, {
      workspaceId: who.workspaceId,
      name: "linkedin.connect.failed",
      actorUserId: who.userId,
      subjectType: "user",
      subjectId: who.userId,
      payload: { provider },
    });
    await recordBeat(ctx.db, "linkedin:connect-failed", {
      at: new Date().toISOString(),
      workspaceId: who.workspaceId,
      userId: who.userId,
      provider,
    });

    /*
     * No sign-in happened, so the row stops saying one is under way.
     *
     * Left at `connecting`, every screen told the rep the product was working
     * on it, when LinkedIn had refused the sign-in and nothing would change
     * until they pressed Connect again. Only a row holding no account is
     * touched: one that already has a working account behind it keeps it, so
     * a failed reconnect never breaks what was working.
     */
    await ctx.db
      .from("linkedin_accounts")
      .update({ status: "disconnected", status_detail: LINKEDIN_NO_SIGN_IN })
      .eq("workspace_id", who.workspaceId)
      .eq("user_id", who.userId)
      .eq("status", "connecting")
      .is("provider_account_id", null);
    return back();
  });

  app.get("/auth/linkedin/done", async (c) => {
    const back = (query: string) => c.redirect(`${ctx.env.APP_URL}/app/profile?${query}#team`, 302);

    const claim = c.req.query("claim");
    const accountId = c.req.query("account_id");
    if (!claim || !ctx.env.CREDENTIALS_KEY) return back(`error=${encodeURIComponent(LINKEDIN_CONNECT_INCOMPLETE)}`);

    let who: { workspaceId: string; userId: string; issuedAt: number };
    try {
      who = decryptState(claim, ctx.env.CREDENTIALS_KEY);
    } catch {
      return back(`error=${encodeURIComponent(LINKEDIN_CONNECT_INCOMPLETE)}`);
    }
    if (Date.now() - who.issuedAt > CLAIM_TOKEN_TTL_MS) return back(`error=${encodeURIComponent(LINKEDIN_CONNECT_EXPIRED)}`);

    // The provider appends this itself. Without it there is nothing to attach,
    // and the page's own check against the provider is the next thing to run.
    if (!accountId) return back("connected=1");

    const result = await claimAccount(ctx, { ...who, accountId });
    if (result.claimed) return back("connected=1");

    // A refusal still sends them to the page, which asks the provider again
    // and says what it found. Silence here is what left somebody pressing a
    // button that changed nothing.
    console.error("claim on return failed", result.reason);
    return back("connected=1");
  });

  app.post("/jobs/linkedin-refresh", async (c) => {
    const parsed = LinkRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    let accounts;
    try {
      accounts = await ctx.linkedin.listAccounts();
    } catch (err) {
      console.error("listing provider accounts failed", operatorProviderFailure(err), err);
      return c.json({ error: describeProviderFailure(err) }, 502);
    }

    // Only this rep's own row is touched, whatever the provider returned.
    const mine = accounts.filter((a) => a.reference === parsed.data.userId);
    const bound = await bindAccounts(ctx, mine);
    const reconciled = await reconcileAccount(ctx.db, parsed.data.workspaceId, parsed.data.userId, mine, accounts);

    // The row already holds an account the provider lists: that is a working
    // connection, whatever label the provider put on it. Reporting "none of
    // them is yours" here told a connected rep she was not connected.
    if (reconciled.unlabelled) {
      return c.json({ found: accounts.length, mine: 0, bound, ...reconciled });
    }

    if (accounts.length > 0 && mine.length === 0) {
      // The provider has accounts but none carries this rep's id as its
      // reference, which is the interesting failure and used to be invisible:
      // the caller saw "no account yet" whether the provider had none or had
      // one under a name we did not recognise.
      //
      // The references are logged in full for whoever holds the credentials,
      // and only their shape is returned — enough to tell "an id that does not
      // match" from "a person's name", without putting one workspace's labels
      // in another's browser.
      console.error("provider accounts matched no rep", {
        wanted: parsed.data.userId,
        references: accounts.map((a) => a.reference),
      });
      // And written where somebody can read it. The log line above is on a
      // host the person repairing this cannot reach, and the response below
      // carries shapes rather than values on purpose — so the one fact needed
      // to attach the row by hand was being discovered and discarded on every
      // single run. Operator-only, never a customer screen (rule 17).
      await recordObservedAccounts(ctx.db, { wanted: parsed.data.userId, accounts });
      /*
       * The shape of what the provider actually sent, field by field.
       *
       * `referenceShape` alone said "text with spaces" and that was true of
       * every account while being useless: it could not distinguish "the
       * provider returned a name because somebody connected in its dashboard"
       * from "the provider returned an id and we read the wrong field". Those
       * need opposite things done about them, and telling them apart cost an
       * afternoon of guessing at a screen that had the answer and would not
       * print it.
       *
       * Still shapes and never values — a reference is one workspace's label
       * and does not belong in another's browser.
       */
      return c.json({
        found: accounts.length,
        mine: 0,
        bound: 0,
        referenceShape: accounts.map((a) => shapeOf(a.reference)),
        expected: shapeOf(parsed.data.userId),
        // What the provider actually sent, key by key, when it cannot be
        // matched. Everything above is our reading of the payload, and three
        // rounds were spent trusting that reading over the payload itself.
        fields: (await ctx.linkedin.describeAccountFields?.()) ?? null,
      });
    }

    return c.json({ found: accounts.length, mine: mine.length, bound, ...reconciled });
  });

  // Google Calendar connect. The Reply Agent cannot offer a time until this is
  // done, so the flow is deliberately two clicks: consent, then callback.
  
  
  
  
  
  
  // Delivers an invitation that the web app has already created and
  // authorised. The token is read here rather than accepted from the caller,
  // so this endpoint cannot be used to mail an arbitrary string as an invite.
  app.post("/jobs/send-invite", async (c) => {
    const parsed = InviteEmailRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    const { data: invitation } = await ctx.db
      .from("invitations")
      .select("id, email, role, token, expires_at, accepted_at, revoked_at")
      .eq("id", parsed.data.invitationId)
      .eq("workspace_id", parsed.data.workspaceId)
      .maybeSingle();
    if (!invitation || invitation.accepted_at || invitation.revoked_at) {
      return c.json({ error: "invitation is not sendable" }, 409);
    }

    const [{ data: workspace }, { data: inviter }] = await Promise.all([
      ctx.db.from("workspaces").select("name").eq("id", parsed.data.workspaceId).maybeSingle(),
      ctx.db.from("profiles").select("full_name").eq("id", parsed.data.userId).maybeSingle(),
    ]);

    const days = Math.max(
      1,
      Math.ceil((Date.parse(invitation.expires_at) - Date.now()) / 86_400_000),
    );

    const delivered = await trySend(
      ctx.email,
      inviteEmail({
        to: invitation.email,
        workspaceName: workspace?.name ?? "a workspace",
        inviterName: inviter?.full_name ?? null,
        role: invitation.role,
        acceptUrl: `${ctx.env.APP_URL}/invite/${invitation.token}`,
        expiresInDays: days,
      }),
    );

    // A false here is not an error: the UI still shows the link to copy.
    return c.json({ delivered });
  });

  for (const integration of OAUTH_INTEGRATIONS) registerOAuthIntegration(app, ctx, integration);

  // Data subject rights. Both are internal calls, so they inherit the shared
  // secret and the membership check.
  app.post("/jobs/erase-prospect", async (c) => {
    const parsed = EraseRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    const result = await eraseProspect(ctx, {
      workspaceId: parsed.data.workspaceId,
      prospectId: parsed.data.prospectId,
      reason: parsed.data.reason,
    });
    return c.json(result);
  });

  app.post("/jobs/export", async (c) => {
    const parsed = ExportRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    return c.json(await exportWorkspace(ctx, parsed.data.workspaceId));
  });

  
  
  // Billing. Checkout and the portal are internal calls; the webhook is public
  // and carries Stripe's own signature.
  app.post("/jobs/checkout", async (c) => {
    const parsed = CheckoutRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    const priceId = {
      solo: ctx.env.STRIPE_PRICE_SOLO,
      pro: ctx.env.STRIPE_PRICE_PRO,
      teams: ctx.env.STRIPE_PRICE_TEAMS,
    }[parsed.data.plan];
    if (!ctx.env.STRIPE_SECRET_KEY || !ctx.env.STRIPE_WEBHOOK_SECRET || !priceId) {
      return c.json({ error: "billing is not configured" }, 501);
    }

    const stripe = new StripeClient({
      secretKey: ctx.env.STRIPE_SECRET_KEY,
      webhookSecret: ctx.env.STRIPE_WEBHOOK_SECRET,
    });

    try {
      const session = await stripe.createCheckoutSession({
        workspaceId: parsed.data.workspaceId,
        priceId,
        quantity: parsed.data.seats,
        customerEmail: parsed.data.email,
        successUrl: `${ctx.env.APP_URL}/app/billing?checkout=success`,
        cancelUrl: `${ctx.env.APP_URL}/app/billing?checkout=cancelled`,
      });
      return c.json({ url: session.url });
    } catch (error) {
      console.error("checkout failed", error);
      return c.json({ error: "could not start checkout" }, 502);
    }
  });

  app.post("/webhooks/stripe", async (c) => {
    if (!ctx.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: "not configured" }, 501);

    const body = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? "";

    let event;
    try {
      event = verifyStripeWebhook({ body, signatureHeader: signature, secret: ctx.env.STRIPE_WEBHOOK_SECRET });
    } catch (error) {
      // An unverified billing event is a free subscription for whoever found
      // the URL, so this rejects rather than logs and continues.
      console.error("rejected stripe webhook", error);
      return c.json({ error: "invalid signature" }, 401);
    }

    // Stripe redelivers, and order is not guaranteed. Recording the event id
    // first makes a repeat a no-op.
    const { error: insertError } = await ctx.db.from("billing_events").insert({
      id: event.id,
      type: event.type,
      payload: event as never,
      workspace_id: workspaceIdFrom(event.data.object),
    });
    if (insertError) {
      // Only a primary-key collision means "already handled". Treating every
      // failure as a duplicate returns 200 to Stripe and silently drops a
      // subscription change, so anything else asks Stripe to retry.
      const duplicate = /duplicate|unique|23505/i.test(insertError.message);
      if (duplicate) return c.json({ received: true, duplicate: true });
      console.error("could not record billing event", insertError.message);
      return c.json({ error: "could not record event" }, 500);
    }

    await applyBillingEvent(ctx, event);
    return c.json({ received: true });
  });

  return app;
}

/** Applies a verified Stripe event to the workspace it names. */
async function applyBillingEvent(
  ctx: WorkerContext,
  event: { type: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  const object = event.data.object;
  const workspaceId = workspaceIdFrom(object);
  if (!workspaceId) return;

  if (event.type === "checkout.session.completed") {
    await ctx.db
      .from("workspaces")
      .update({
        stripe_customer_id: asString(object.customer),
        stripe_subscription_id: asString(object.subscription),
      })
      .eq("id", workspaceId);
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    const status = normalizeSubscriptionStatus(asString(object.status));
    const items = object.items as { data?: Array<{ price?: { lookup_key?: string }; quantity?: number }> } | undefined;
    const first = items?.data?.[0];
    const periodEnd = typeof object.current_period_end === "number"
      ? new Date(object.current_period_end * 1000).toISOString()
      : null;

    await ctx.db
      .from("workspaces")
      .update({
        subscription_status: status,
        // A deleted subscription keeps its plan name so the UI can say what
        // they had, while the status is what actually gates sending.
        ...(event.type === "customer.subscription.deleted"
          ? {}
          : { plan: planFromPriceLookupKey(first?.price?.lookup_key) }),
        seats: first?.quantity ?? 1,
        current_period_end: periodEnd,
        stripe_subscription_id: asString(object.id),
      })
      .eq("id", workspaceId);
  }
}

function workspaceIdFrom(object: Record<string, unknown>): string | null {
  const metadata = object.metadata as Record<string, unknown> | undefined;
  return asString(metadata?.workspace_id) ?? asString(object.client_reference_id);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}


/**
 * The four OAuth integrations differ in four ways: which credentials configure
 * them, how a code becomes tokens, what the stored integration is called, and
 * whether the connection belongs to one rep or the whole workspace. Everything
 * else — the missing-code check, the signed-state decrypt, the one-hour
 * consent window, the refusal to store a grant with no refresh token, the
 * encrypted upsert and the error redirects — was written out four times.
 *
 * A bug in any of those was previously four bugs, and adding a fifth provider
 * meant copying the whole shape again.
 */
interface OAuthIntegration {
  /** Path segment: /auth/<name>/link and /auth/<name>/callback. */
  name: string;
  kind: IntegrationKind;
  /** Whose connection this is. A calendar is one rep's; a CRM is the team's. */
  scope: "user" | "workspace";
  /** Query flag on the success redirect, so the UI can say what connected. */
  connectedFlag: "calendar" | "crm";
  /** Null when the provider is not configured, which returns 501 rather than 500. */
  consentUrl(ctx: WorkerContext, input: { state: string; redirectUri: string }): string | null;
  /**
   * Returns whatever token shape the provider gives back. It is stored
   * encrypted and handed straight to that provider's own refresh function, so
   * this layer only needs to know whether a refresh token came with it.
   */
  exchange(ctx: WorkerContext, input: { code: string; redirectUri: string }): Promise<{ refreshToken?: string }>;
}

function registerOAuthIntegration(app: Hono, ctx: WorkerContext, integration: OAuthIntegration): void {
  const redirectUri = `${ctx.env.WORKER_URL}/auth/${integration.name}/callback`;
  const back = (query: string) => `${ctx.env.APP_URL}/app/team?${query}`;

  app.post(`/auth/${integration.name}/link`, async (c) => {
    const parsed = LinkRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!ctx.env.CREDENTIALS_KEY) return c.json({ error: `${integration.name} is not configured` }, 501);
    if (!(await assertMembership(ctx.db, parsed.data.workspaceId, parsed.data.userId))) {
      return c.json({ error: "not a member of that workspace" }, 403);
    }

    const url = integration.consentUrl(ctx, {
      state: encodeState(parsed.data.workspaceId, parsed.data.userId, ctx.env.CREDENTIALS_KEY),
      redirectUri,
    });
    if (!url) return c.json({ error: `${integration.name} is not configured` }, 501);
    return c.json({ url });
  });

  app.get(`/auth/${integration.name}/callback`, async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.redirect(back("error=missing_code"));
    if (!ctx.env.CREDENTIALS_KEY) return c.redirect(back("error=not_configured"));

    let claims: { workspaceId: string; userId: string; issuedAt: number };
    try {
      claims = decryptState(state, ctx.env.CREDENTIALS_KEY);
    } catch {
      return c.redirect(back("error=bad_state"));
    }
    // A consent link older than an hour is not honoured.
    if (Date.now() - claims.issuedAt > 3_600_000) return c.redirect(back("error=expired"));

    try {
      const tokens = await integration.exchange(ctx, { code, redirectUri });

      // Without a refresh token the connection dies within the hour; make the
      // rep re-consent rather than storing something that will silently expire.
      if (!tokens.refreshToken) return c.redirect(back("error=no_refresh_token"));

      await ctx.db.from("integrations").upsert(
        {
          workspace_id: claims.workspaceId,
          user_id: integration.scope === "user" ? claims.userId : null,
          kind: integration.kind,
          credentials_encrypted: encryptJson(tokens, ctx.env.CREDENTIALS_KEY),
          status: "active",
        },
        { onConflict: "workspace_id,kind,user_id" },
      );

      return c.redirect(back(`${integration.connectedFlag}=connected`));
    } catch (error) {
      console.error(`${integration.name} callback failed`, error);
      return c.redirect(back("error=exchange_failed"));
    }
  });
}

const OAUTH_INTEGRATIONS: OAuthIntegration[] = [
  {
    name: "google",
    kind: "google_calendar",
    scope: "user",
    connectedFlag: "calendar",
    consentUrl: (ctx, { state, redirectUri }) =>
      ctx.env.GOOGLE_CLIENT_ID
        ? googleConsentUrl({ clientId: ctx.env.GOOGLE_CLIENT_ID, redirectUri, state })
        : null,
    exchange: (ctx, { code, redirectUri }) =>
      exchangeGoogleCode({
        code,
        clientId: ctx.env.GOOGLE_CLIENT_ID!,
        clientSecret: ctx.env.GOOGLE_CLIENT_SECRET!,
        redirectUri,
      }),
  },
  {
    name: "microsoft",
    kind: "microsoft_calendar",
    scope: "user",
    connectedFlag: "calendar",
    consentUrl: (ctx, { state, redirectUri }) =>
      ctx.env.MICROSOFT_CLIENT_ID
        ? microsoftConsentUrl({
            clientId: ctx.env.MICROSOFT_CLIENT_ID,
            redirectUri,
            state,
            tenant: ctx.env.MICROSOFT_TENANT,
          })
        : null,
    exchange: (ctx, { code, redirectUri }) =>
      exchangeMicrosoftCode({
        code,
        clientId: ctx.env.MICROSOFT_CLIENT_ID!,
        clientSecret: ctx.env.MICROSOFT_CLIENT_SECRET!,
        redirectUri,
        tenant: ctx.env.MICROSOFT_TENANT,
      }),
  },
  {
    name: "hubspot",
    kind: "hubspot",
    // A CRM connection is workspace-wide: every rep's activity should land in
    // the same portal.
    scope: "workspace",
    connectedFlag: "crm",
    consentUrl: (ctx, { state, redirectUri }) =>
      ctx.env.HUBSPOT_CLIENT_ID
        ? hubspotConsentUrl({ clientId: ctx.env.HUBSPOT_CLIENT_ID, redirectUri, state })
        : null,
    exchange: (ctx, { code, redirectUri }) =>
      exchangeHubSpotCode({
        code,
        clientId: ctx.env.HUBSPOT_CLIENT_ID!,
        clientSecret: ctx.env.HUBSPOT_CLIENT_SECRET!,
        redirectUri,
      }),
  },
  {
    name: "salesforce",
    kind: "salesforce",
    scope: "workspace",
    connectedFlag: "crm",
    consentUrl: (ctx, { state, redirectUri }) =>
      ctx.env.SALESFORCE_CLIENT_ID
        ? salesforceConsentUrl({
            clientId: ctx.env.SALESFORCE_CLIENT_ID,
            redirectUri,
            state,
            loginUrl: ctx.env.SALESFORCE_LOGIN_URL,
          })
        : null,
    exchange: (ctx, { code, redirectUri }) =>
      exchangeSalesforceCode({
        code,
        clientId: ctx.env.SALESFORCE_CLIENT_ID!,
        clientSecret: ctx.env.SALESFORCE_CLIENT_SECRET!,
        redirectUri,
        loginUrl: ctx.env.SALESFORCE_LOGIN_URL,
      }),
  },
];

/**
 * Constant-time bearer check. A missing secret fails closed: an unauthenticated
 * internal API is worse than a worker that refuses to start work.
 */
/**
 * The credentials a Unipile webhook delivery can carry. Never logged.
 *
 * `unipile-auth` is the header name Unipile's own v1 documentation uses as its
 * example, so it is what the webhook should be configured with; `x-unipile-auth`
 * is accepted for the same reason the signature's x- spelling is.
 */
function webhookCredentials(c: { req: { header(name: string): string | undefined } }): {
  signature?: string;
  authHeader?: string;
} {
  return {
    signature: c.req.header("unipile-signature") ?? c.req.header("x-unipile-signature") ?? undefined,
    authHeader: c.req.header("unipile-auth") ?? c.req.header("x-unipile-auth") ?? undefined,
  };
}

function requireInternalAuth(secret: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!secret) return c.json({ error: "worker is not configured for internal calls" }, 503);

    const header = c.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!constantTimeEquals(presented, secret)) return c.json({ error: "unauthorized" }, 401);

    await next();
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Compare a fixed-size digest-like buffer so length alone does not leak via
  // an early return; timingSafeEqual itself requires equal lengths.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function decryptState(state: string, key: string): { workspaceId: string; userId: string; issuedAt: number } {
  return decryptJson(state, key);
}

/**
 * What went wrong with the provider, said to the person who clicked.
 *
 * The three cases below need three different actions and are indistinguishable
 * from a 500: a rejected key is the deployment's to fix, a 404 is almost always
 * the DSN (which is per-account and includes a port, so it is the value people
 * get wrong), and a 5xx is nobody's to fix but will pass.
 */
/**
 * What went wrong with the provider, said to the person who clicked.
 *
 * This text goes into a redirect's `?error=` and is rendered in the red banner
 * on `/app/profile`, so the reader is the rep who just pressed Connect
 * LinkedIn. It used to tell them, in these words, that "its administrator
 * needs to check the Unipile access token" — naming the vendor we buy LinkedIn
 * access from, naming the credential, and assigning the repair to somebody
 * they are not, on the single most-used screen in the product. Rule 54 moved
 * exactly this off `/app/system`; it was still live here, in the one flow
 * every customer has to complete before anything works at all.
 *
 * The distinction that matters is not how much detail to give, it is whose
 * fault it is. A rejected credential and a misconfigured address are the
 * deployment's; a provider outage is nobody's and will pass; a refusal with a
 * status is worth reporting as a refusal. None of the three is a thing the rep
 * can act on, so all three say so plainly and point at support rather than
 * describing a remedy they cannot perform.
 */
function describeProviderFailure(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403 || status === 404) {
    // Ours, and the two cases are one sentence to them: nothing they do on
    // this page will change it.
    return "We could not connect to LinkedIn on your behalf. This is ours to fix rather than yours — tell us from the Support page and we will.";
  }
  if (typeof status === "number" && status >= 500) {
    return "LinkedIn is having a problem on their side. Please try again in a few minutes.";
  }
  if (typeof status === "number") {
    return "LinkedIn refused the request. If it keeps happening, tell us from the Support page.";
  }
  return "We could not reach LinkedIn just now. Please try again, and tell us from the Support page if it keeps happening.";
}

/**
 * The same fault for whoever runs the deployment.
 *
 * Moving the sentence is the point; deleting it is not (rule 54). Somebody
 * still has to fix the credentials, and this is the version that names which
 * ones — recorded in the worker's own log and on the operator's half of
 * `/app/system`, never returned to the browser.
 *
 * A 401 and a 404 are different people doing different things: a rejected key
 * is the access token, and a 404 is almost always the DSN, which is
 * per-account and carries a port, so it is the value that gets pasted wrong.
 * Telling somebody to re-copy a credential that was already correct is its own
 * wasted afternoon.
 */
function operatorProviderFailure(err: unknown): string {
  const status = (err as { status?: number })?.status;
  const said = (err as { message?: string })?.message ?? "no message";
  if (status === 401 || status === 403) {
    return `The provider rejected this deployment's credentials (${status}). Check UNIPILE_ACCESS_TOKEN, and that it belongs to the same tenant as UNIPILE_DSN. Provider said: ${said}`;
  }
  if (status === 404) {
    return `The provider could not be reached at the configured address (404). Check UNIPILE_DSN, including its port. Provider said: ${said}`;
  }
  if (typeof status === "number") {
    return `The provider refused the request (${status}). Provider said: ${said}`;
  }
  // No status means no HTTP response at all — the request never completed, so
  // this is the address or the network rather than anything the provider said.
  return `No HTTP response from the provider, so this is the address or the network rather than anything it said: ${said}`;
}

/**
 * Binds provider accounts to the rows waiting for them.
 *
 * Shared by the webhook and the refresh route so the two cannot drift: one of
 * them writing a different status, or matching on something else, would mean a
 * connection that behaves differently depending on how it arrived.
 */
/**
 * How often an unverified delivery may make us call the provider.
 *
 * The endpoint answers before anyone is authenticated, so this is the whole
 * defence against an open door turning into an amplifier. Thirty seconds is
 * short enough that a real connection binds while the rep is still looking at
 * the page, and long enough that a flood costs two provider calls a minute.
 */
/**
 * Where the hosted flow sends the rep back, and what it carries.
 *
 * Falls back to the app page when there is no key to mint a token with, so a
 * deployment without CREDENTIALS_KEY keeps the behaviour it had rather than
 * losing the ability to connect at all.
 */
function claimReturnUrl(ctx: WorkerContext, workspaceId: string, userId: string): string {
  if (!ctx.env.CREDENTIALS_KEY) return `${ctx.env.APP_URL}/app/profile?connected=1#team`;
  const claim = encodeState(workspaceId, userId, ctx.env.CREDENTIALS_KEY);
  return `${ctx.env.WORKER_URL}/auth/linkedin/done?claim=${encodeURIComponent(claim)}`;
}

/**
 * Where the hosted flow sends somebody whose LinkedIn sign-in did not work.
 *
 * It used to go straight to the app page with `?error=connection_failed`, and
 * two things followed. The banner printed that code verbatim — a red box
 * reading "connection_failed", no reason, no next step — and the page beneath
 * it said to press Connect LinkedIn, which failed the same way: the loop the
 * first customers kept reporting as "stuck on connecting". And nothing was
 * written anywhere, so "LinkedIn refused her sign-in" and "she never tried
 * again" were the same empty database from every place anybody could look.
 *
 * So it comes back through the worker, carrying the same signed token the
 * success path does, and the failure is recorded against the workspace it
 * belongs to before the person is sent on with a sentence that says what
 * usually causes it.
 */
function claimFailureUrl(ctx: WorkerContext, workspaceId: string, userId: string): string {
  if (!ctx.env.CREDENTIALS_KEY) {
    return `${ctx.env.APP_URL}/app/profile?error=${encodeURIComponent(LINKEDIN_SIGN_IN_FAILED)}#team`;
  }
  const claim = encodeState(workspaceId, userId, ctx.env.CREDENTIALS_KEY);
  return `${ctx.env.WORKER_URL}/auth/linkedin/failed?claim=${encodeURIComponent(claim)}`;
}

/**
 * What a failed LinkedIn sign-in says to the person it happened to.
 *
 * The provider does not tell us why, so this names the three causes that
 * account for nearly all of them, most common first. The first is the one
 * nobody guesses: a LinkedIn account opened with "Continue with Google" or
 * Apple has no LinkedIn password at all, so there is nothing to type on the
 * sign-in page, and every attempt fails identically until one is set.
 */
const LINKEDIN_SIGN_IN_FAILED =
  "LinkedIn didn't finish signing you in. The usual reasons: (1) you normally sign in to LinkedIn with Google or Apple, so your LinkedIn account has no password yet — set one in LinkedIn under Settings → Sign in & security → Change password, then try again; (2) LinkedIn asked for a verification code — have your phone or email open when you press Connect; (3) the password was mistyped. Press Connect LinkedIn to try again, or tell us from the Support page and we'll walk through it with you.";

/** What the account row says after a refused sign-in, on every screen that shows it. */
const LINKEDIN_NO_SIGN_IN =
  "No sign-in happened, so no LinkedIn account is connected. Press Connect LinkedIn to try again.";

/** Rows a Connect press may move to `connecting`: the ones holding nothing usable. */
const RESTARTABLE_STATUSES: string[] = ["connecting", "disconnected"];

/** The return trip broke before LinkedIn was even reached, or took too long. */
const LINKEDIN_CONNECT_INCOMPLETE =
  "The connection to LinkedIn didn't complete. Press Connect LinkedIn to start again — it takes about a minute.";
const LINKEDIN_CONNECT_EXPIRED =
  "That LinkedIn sign-in link expired after an hour. Press Connect LinkedIn to start a fresh one.";

/** A claim token is good for an hour: long enough to sign in to LinkedIn, short enough to be worthless later. */
const CLAIM_TOKEN_TTL_MS = 60 * 60_000;

type ClaimOutcome =
  | { status: "ok"; claimed: true; accountStatus: string }
  | { status: "refused"; claimed: false; reason: string }
  | { status: "provider_error"; claimed: false; reason: string };

/**
 * Attach the account the hosted flow produced to the row that is waiting for
 * one.
 *
 * Lifted out of the route because it now has two callers and they arrive with
 * the rep's identity established in different ways — a signed-in session on
 * one, a token this worker minted on the other. Everything after that point is
 * the same, and it is the part that must not differ: ask the provider rather
 * than believe the id, never take an account another row already holds, and
 * only ever fill a row this workspace's own Connect press left waiting.
 */
async function claimAccount(
  ctx: WorkerContext,
  input: { workspaceId: string; userId: string; accountId: string },
): Promise<ClaimOutcome> {
  // Asked, not assumed: an id from a query string is a claim about the
  // provider, and the provider is the one that settles it.
  let accounts;
  try {
    accounts = await ctx.linkedin.listAccounts();
  } catch (err) {
    console.error("claim could not ask the provider", operatorProviderFailure(err), err);
    return { status: "provider_error", claimed: false, reason: describeProviderFailure(err) };
  }

  const match = accounts.find((a) => a.providerAccountId === input.accountId);
  if (!match) return { status: "refused", claimed: false, reason: "the provider has no such account" };

  // Somebody else's, and not available to be taken.
  const { data: taken } = await ctx.db
    .from("linkedin_accounts")
    .select("id, user_id, status")
    .eq("provider_account_id", input.accountId)
    .maybeSingle();
  if (taken && taken.user_id !== input.userId) {
    return { status: "refused", claimed: false, reason: "that account is already attached to someone else" };
  }

  /*
   * A reconnect that came back with the account this row already holds is a
   * success, not a refusal. Pressing Connect on a working account no longer
   * sets it to `connecting` (see `/auth/linkedin/link`), so without this the
   * rep who signed in again perfectly well would be told it had not worked.
   * It never re-points a working row onto a *different* account — rule 8.
   */
  if (taken && taken.user_id === input.userId) {
    // Only a row waiting on a sign-in moves. A paused or restricted one keeps
    // what somebody, or LinkedIn, decided about it.
    if (["connecting", "reauth_required"].includes(String(taken.status))) {
      await ctx.db
        .from("linkedin_accounts")
        .update({ status: match.status === "ok" ? "active" : "reauth_required", status_detail: null })
        .eq("id", taken.id);
    }
    return { status: "ok", claimed: true, accountStatus: match.status };
  }

  const { data: pending } = await ctx.db
    .from("linkedin_accounts")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .in("status", ["connecting", "reauth_required", "restricted"])
    .maybeSingle();
  if (!pending) return { status: "refused", claimed: false, reason: "no connection was started here" };

  await ctx.db
    .from("linkedin_accounts")
    .update({
      provider_account_id: match.providerAccountId,
      display_name: match.displayName ?? null,
      status: match.status === "ok" ? "active" : "reauth_required",
      status_detail: null,
      connected_at: new Date().toISOString(),
      paused_at: null,
    })
    .eq("id", pending.id);

  await recordBeat(ctx.db, "linkedin:claim", {
    at: new Date().toISOString(),
    claimed: true,
    status: match.status,
  });
  return { status: "ok", claimed: true, accountStatus: match.status };
}

const NOTICE_PULL_DEBOUNCE_MS = 30_000;

/**
 * Failed jobs per queue, with their most recent reasons, for the Issues tab.
 *
 * Only the last day's. BullMQ's `removeOnFail: { age }` is applied lazily —
 * when another job in the same queue fails — so a queue that stopped failing
 * keeps its old failures for ever. 220 "Custom Id cannot contain :" jobs from
 * the bug rule 39 fixed sat in campaignTick for weeks, and the Issues tab
 * reported a fault that no longer existed beside the ones that did. Nightly
 * maintenance now deletes the old ones too; this keeps the page honest in
 * between.
 *
 * Asked with a deadline: a command against an unreachable Redis waits for ever
 * (rule 22), and an operator page that hangs tells nobody anything. A queue
 * that cannot be asked is left out rather than reported as clean — the boot
 * stamp already says when the queue is down.
 */
async function failedJobCounts(queues: Queues, now: Date = new Date()): Promise<QueueCounts | null> {
  const ask = async (): Promise<QueueCounts> => {
    const out: QueueCounts = {};
    for (const [name, queue] of Object.entries(queues)) {
      const counts = await queue.getJobCounts("failed");
      const jobs = (counts.failed ?? 0) > 0 ? await queue.getFailed(0, 499) : [];
      out[name] = recentFailures(jobs, now);
    }
    return out;
  };
  try {
    return await Promise.race([ask(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000))]);
  } catch {
    return null;
  }
}

/**
 * Ask the provider what it actually has, because something says it changed.
 *
 * Never reads the delivery. The caller has already refused it; this only turns
 * "somebody rang" into "so we looked", and what it looks at is a list we
 * fetched ourselves. Failures are swallowed on purpose: this runs beside a
 * response that has already been decided, and a provider outage must not turn
 * a 401 into a 500.
 */
async function pullAfterUnverifiedNotice(ctx: WorkerContext): Promise<void> {
  try {
    const { data: last } = await ctx.db
      .from("worker_heartbeats")
      .select("beat_at")
      .eq("name", "accounts:pull")
      .maybeSingle();

    const since = last?.beat_at ? Date.now() - new Date(last.beat_at).getTime() : Infinity;
    if (since < NOTICE_PULL_DEBOUNCE_MS) return;

    // Stamped before the work, not after: two deliveries arriving together
    // would otherwise both read a stale timestamp and both call the provider.
    await recordBeat(ctx.db, "accounts:pull", { at: new Date().toISOString(), trigger: "unverified-notice" });

    const result = await recoverAccounts(ctx.db, ctx.linkedin);
    await recordBeat(ctx.db, "accounts:pull", {
      at: new Date().toISOString(),
      trigger: "unverified-notice",
      checked: result.checked,
      repaired: result.repaired,
      // `repaired: 0` because there was nothing to fix, and `repaired: 0`
      // because the provider refused the call, are the same two words and
      // completely different afternoons.
      unreachable: result.unreachable,
    });
  } catch (err) {
    console.error("pull after unverified account notice failed", err);
  }
}

async function bindAccounts(ctx: WorkerContext, accounts: ConnectedAccount[]): Promise<number> {
  let bound = 0;
  for (const account of accounts) {
    // Matched on the reference we handed the hosted flow, and only against a
    // row that is actually waiting for it. An already-connected account is not
    // re-bound by a replayed delivery.
    const { data: pending } = await ctx.db
      .from("linkedin_accounts")
      .select("id")
      .eq("user_id", account.reference)
      .in("status", ["connecting", "reauth_required", "restricted"])
      .maybeSingle();
    if (!pending) continue;

    await ctx.db
      .from("linkedin_accounts")
      .update({
        provider_account_id: account.providerAccountId,
        display_name: account.displayName ?? null,
        status: account.status === "ok" ? "active" : "reauth_required",
        status_detail: null,
        // Starts the warm-up ramp. A freshly connected account sends at the low
        // daily cap until it has some age on it.
        connected_at: new Date().toISOString(),
        paused_at: null,
      })
      .eq("id", pending.id);
    bound++;
  }
  return bound;
}

/**
 * What a value looks like, without saying what it is.
 *
 * Enough to tell a uuid that does not match from a person's display name,
 * which is the difference between "the reference is wrong" and "the provider
 * is not storing our reference at all" — two different bugs that were
 * indistinguishable from the outside.
 */
function shapeOf(value: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "uuid";
  if (/\s/.test(value)) return "text with spaces";
  return `${value.length} characters, no spaces`;
}
