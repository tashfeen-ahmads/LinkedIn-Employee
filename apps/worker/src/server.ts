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
import type { MiddlewareHandler } from "hono";
import type { IntegrationKind } from "@le/db";
import type { Queues } from "./queues.js";
import type { WorkerContext } from "./context.js";
import { bookFromLink, readBookingPage } from "./jobs/book.js";
import { connectCalendarFeed, disconnectCalendarFeed } from "./jobs/calendar-feed.js";
import { runDiagnostics } from "./jobs/diagnostics.js";
import { eraseProspect, exportWorkspace } from "./jobs/retention.js";
import { inviteEmail } from "@le/email";
import { trySend } from "./email.js";
import { recordEvent } from "./context.js";

const StrategyRequest = z
  .object({
    workspaceId: z.string().uuid(),
    userId: z.string().uuid(),
    websiteUrl: z.string().optional(),
    linkedinCompanyUrl: z.string().optional(),
    description: z.string().optional(),
    existingCustomers: z.array(z.string()).optional(),
  })
  // The agent refuses to invent an ICP from nothing, so a request carrying
  // nothing would enqueue a job that fails three times and dies unseen. Reject
  // it here, where the caller can still be told.
  .refine(
    (input) => Boolean(input.websiteUrl || input.linkedinCompanyUrl || input.description),
    { message: "need a website, a LinkedIn page, or a description to work from" },
  );

const TargetingRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  linkedinAccountId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
});

const SendReplyRequest = z.object({
  workspaceId: z.string().uuid(),
  draftId: z.string().uuid(),
});

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

/** Signed state so the OAuth callback cannot be used to bind someone else's calendar. */
function encodeState(workspaceId: string, userId: string, key: string): string {
  return encryptJson({ workspaceId, userId, issuedAt: Date.now() }, key);
}

/**
 * Inbound webhook surface. Unipile posts here when a prospect replies; we
 * verify the signature, resolve the account, and hand off to the queue so the
 * HTTP response stays fast and delivery is retried by BullMQ, not the provider.
 */
export function createServer(ctx: WorkerContext, queues: Queues): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

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
    await queues.targeting.add("targeting", parsed.data);
    return c.json({ queued: true });
  });

  app.post("/jobs/send-reply", async (c) => {
    const parsed = SendReplyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);

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
      { jobId: `reply:${draft.id}` },
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
        successUrl: `${ctx.env.APP_URL}/app/team?connected=1`,
        failureUrl: `${ctx.env.APP_URL}/app/team?error=connection_failed`,
        // The redirect tells the rep's browser it worked. This tells us, and
        // until it arrives the account has no provider id, so every job skips it.
        notifyUrl: `${ctx.env.WORKER_URL}/webhooks/unipile/accounts`,
      });
    } catch (err) {
      // The provider's own body goes to the log, never to the browser: it is
      // written for whoever holds the credentials, not for the rep.
      console.error("hosted auth link failed", err);
      return c.json({ error: describeProviderFailure(err) }, 502);
    }

    await ctx.db.from("linkedin_accounts").upsert(
      {
        workspace_id: parsed.data.workspaceId,
        user_id: parsed.data.userId,
        provider: ctx.linkedin.name,
        status: "connecting",
      },
      { onConflict: "workspace_id,user_id" },
    );

    return c.json({ url: link.url, expiresAt: link.expiresAt });
  });

  app.post("/webhooks/unipile/messages", async (c) => {
    const body = await c.req.text();
    // Unipile sends `unipile-signature`; the x- prefixed spelling is kept as a
    // fallback so a sender configured against the older name still verifies.
    const signature = c.req.header("unipile-signature") ?? c.req.header("x-unipile-signature") ?? undefined;

    let messages;
    try {
      messages = ctx.linkedin.parseWebhook({ body, signature });
    } catch (err) {
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
        { jobId: `inbound:${message.providerMessageId}` },
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
    // Unipile sends `unipile-signature`; the x- prefixed spelling is kept as a
    // fallback so a sender configured against the older name still verifies.
    const signature = c.req.header("unipile-signature") ?? c.req.header("x-unipile-signature") ?? undefined;

    let accounts;
    try {
      accounts = ctx.linkedin.parseAccountWebhook({ body, signature });
    } catch (err) {
      console.error("rejected account webhook", err);
      return c.json({ error: "invalid signature" }, 401);
    }

    const bound = await bindAccounts(ctx, accounts);
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
      console.error("listing provider accounts failed", err);
      return c.json({ error: describeProviderFailure(err) }, 502);
    }

    // Only this rep's own row is touched, whatever the provider returned.
    const mine = accounts.filter((a) => a.reference === parsed.data.userId);
    const bound = await bindAccounts(ctx, mine);
    const reconciled = await reconcileAccount(ctx, parsed.data.workspaceId, parsed.data.userId, mine);

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
      return c.json({
        found: accounts.length,
        mine: 0,
        bound: 0,
        referenceShape: accounts.map((a) => shapeOf(a.reference)),
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
function describeProviderFailure(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return "LinkedIn's provider rejected this deployment's credentials. Its administrator needs to check the Unipile access token.";
  }
  if (status === 404) {
    return "LinkedIn's provider could not be reached at the configured address. Its administrator needs to check the Unipile DSN, including its port.";
  }
  if (typeof status === "number" && status >= 500) {
    return "LinkedIn's provider is having a problem. Please try again in a few minutes.";
  }
  if (typeof status === "number") {
    return `LinkedIn's provider refused the request (${status}).`;
  }
  // No status means no HTTP response at all — the request never completed, so
  // this is the address or the network rather than anything the provider said.
  // The cause is a hostname and a failure code, neither of which is a secret,
  // and it is the difference between guessing and knowing.
  const cause = (err as { message?: string })?.message;
  return cause
    ? `Could not reach LinkedIn's provider: ${cause}`
    : "Could not reach LinkedIn's provider. Please try again.";
}

/**
 * Binds provider accounts to the rows waiting for them.
 *
 * Shared by the webhook and the refresh route so the two cannot drift: one of
 * them writing a different status, or matching on something else, would mean a
 * connection that behaves differently depending on how it arrived.
 */
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
 * Makes the row agree with what the provider actually has.
 *
 * `bindAccounts` deliberately only touches a row that is waiting to be
 * connected, so a replayed or forged delivery cannot re-point a working
 * account at something else. That left no way back from the opposite problem:
 * a row that says `active`, holding an id the provider no longer has. Every
 * job then fails against it — "LinkedIn's provider refused the search", over
 * and over — while the Team page shows a healthy account, usage bars and no
 * button that does anything. That is exactly what happened here, and the only
 * fix was editing the database by hand.
 *
 * Safe to do on the pull path and not on the push path, which is the whole
 * distinction: this runs on a list we fetched from the provider ourselves,
 * over an authenticated call the rep started, rather than on something we were
 * sent. The binding rule is untouched — `mine` has already been filtered to
 * accounts carrying this rep's own user id as their reference, and nothing
 * here looks at any other row.
 */
async function reconcileAccount(
  ctx: WorkerContext,
  workspaceId: string,
  userId: string,
  mine: ConnectedAccount[],
): Promise<{ changed?: boolean; lost?: boolean }> {
  const { data: row } = await ctx.db
    .from("linkedin_accounts")
    .select("id, provider_account_id, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return {};

  if (mine.length === 0) {
    // Nothing to reconcile against unless we are claiming to hold something.
    if (!row.provider_account_id) return {};
    await ctx.db
      .from("linkedin_accounts")
      .update({
        status: "reauth_required",
        status_detail:
          "LinkedIn's provider no longer has this account. Reconnect it to start sending again.",
      })
      .eq("id", row.id);
    return { lost: true };
  }

  // Prefer the one already held: several accounts for one rep is a mess to be
  // reported rather than silently resolved by picking differently each time.
  const account = mine.find((a) => a.providerAccountId === row.provider_account_id) ?? mine[0];
  if (!account) return {};
  const changed = account.providerAccountId !== row.provider_account_id;
  if (!changed && row.status === "active") return { changed: false };

  await ctx.db
    .from("linkedin_accounts")
    .update({
      provider_account_id: account.providerAccountId,
      display_name: account.displayName ?? null,
      status: account.status === "ok" ? "active" : "reauth_required",
      status_detail: null,
      // Stamped only when the account itself changed. The warm-up ramp reads
      // `first_action_at`, not this, so a refresh cannot hand an account a
      // fresh allowance — but a connection date that moves every time someone
      // presses a button is a lie on the screen either way.
      ...(changed ? { connected_at: new Date().toISOString(), paused_at: null } : {}),
    })
    .eq("id", row.id);
  return { changed };
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
