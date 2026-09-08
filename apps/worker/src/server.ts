import { Hono } from "hono";
import { z } from "zod";
import { exchangeGoogleCode, googleConsentUrl } from "@le/calendar";
import { decryptJson, encryptJson } from "./crypto.js";
import type { Queues } from "./queues.js";
import type { WorkerContext } from "./context.js";

const StrategyRequest = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  websiteUrl: z.string().optional(),
  linkedinCompanyUrl: z.string().optional(),
  description: z.string().optional(),
  existingCustomers: z.array(z.string()).optional(),
});

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

  // Job entry points used by the web app. These enqueue and return; nothing
  // that touches LinkedIn or Claude happens on the request thread.
  app.post("/jobs/strategy", async (c) => {
    const parsed = StrategyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    await queues.strategy.add("strategy", parsed.data);
    return c.json({ queued: true });
  });

  app.post("/jobs/targeting", async (c) => {
    const parsed = TargetingRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
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

    const link = await ctx.linkedin.createHostedAuthLink({
      userId: parsed.data.userId,
      successUrl: `${ctx.env.APP_URL}/app/team?connected=1`,
      failureUrl: `${ctx.env.APP_URL}/app/team?error=connection_failed`,
    });

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
    const signature = c.req.header("x-unipile-signature") ?? undefined;

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

  // Google Calendar connect. The Reply Agent cannot offer a time until this is
  // done, so the flow is deliberately two clicks: consent, then callback.
  app.post("/auth/google/link", async (c) => {
    const parsed = LinkRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!ctx.env.GOOGLE_CLIENT_ID || !ctx.env.CREDENTIALS_KEY) {
      return c.json({ error: "google calendar is not configured" }, 501);
    }

    const url = googleConsentUrl({
      clientId: ctx.env.GOOGLE_CLIENT_ID,
      redirectUri: `${ctx.env.WORKER_URL}/auth/google/callback`,
      state: encodeState(parsed.data.workspaceId, parsed.data.userId, ctx.env.CREDENTIALS_KEY),
    });
    return c.json({ url });
  });

  app.get("/auth/google/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.redirect(`${ctx.env.APP_URL}/app/team?error=missing_code`);
    if (!ctx.env.GOOGLE_CLIENT_ID || !ctx.env.GOOGLE_CLIENT_SECRET || !ctx.env.CREDENTIALS_KEY) {
      return c.redirect(`${ctx.env.APP_URL}/app/team?error=not_configured`);
    }

    let claims: { workspaceId: string; userId: string; issuedAt: number };
    try {
      claims = decryptState(state, ctx.env.CREDENTIALS_KEY);
    } catch {
      return c.redirect(`${ctx.env.APP_URL}/app/team?error=bad_state`);
    }
    // A consent link older than an hour is not honoured.
    if (Date.now() - claims.issuedAt > 3_600_000) {
      return c.redirect(`${ctx.env.APP_URL}/app/team?error=expired`);
    }

    try {
      const tokens = await exchangeGoogleCode({
        code,
        clientId: ctx.env.GOOGLE_CLIENT_ID,
        clientSecret: ctx.env.GOOGLE_CLIENT_SECRET,
        redirectUri: `${ctx.env.WORKER_URL}/auth/google/callback`,
      });

      if (!tokens.refreshToken) {
        // Without a refresh token the connection dies in an hour; make the rep
        // re-consent rather than storing something that will silently expire.
        return c.redirect(`${ctx.env.APP_URL}/app/team?error=no_refresh_token`);
      }

      await ctx.db.from("integrations").upsert(
        {
          workspace_id: claims.workspaceId,
          user_id: claims.userId,
          kind: "google_calendar",
          credentials_encrypted: encryptJson(tokens, ctx.env.CREDENTIALS_KEY),
          status: "active",
        },
        { onConflict: "workspace_id,kind,user_id" },
      );

      return c.redirect(`${ctx.env.APP_URL}/app/team?calendar=connected`);
    } catch (error) {
      console.error("google callback failed", error);
      return c.redirect(`${ctx.env.APP_URL}/app/team?error=exchange_failed`);
    }
  });

  return app;
}

function decryptState(state: string, key: string): { workspaceId: string; userId: string; issuedAt: number } {
  return decryptJson(state, key);
}
