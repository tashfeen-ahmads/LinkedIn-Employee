import { Hono } from "hono";
import type { Queues } from "./queues.js";
import type { WorkerContext } from "./context.js";

/**
 * Inbound webhook surface. Unipile posts here when a prospect replies; we
 * verify the signature, resolve the account, and hand off to the queue so the
 * HTTP response stays fast and delivery is retried by BullMQ, not the provider.
 */
export function createServer(ctx: WorkerContext, queues: Queues): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

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
