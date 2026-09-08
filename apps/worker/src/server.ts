import { Hono } from "hono";
import { z } from "zod";
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

  return app;
}
