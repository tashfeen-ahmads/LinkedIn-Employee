import { estimateCostUsd } from "@le/shared";
import { createLlmClient, type AgentContext } from "@le/agents";
import { createServiceClient, type Db } from "@le/db";
import { MockLinkedInProvider, UnipileProvider, type LinkedInProvider } from "@le/linkedin";
import type { EmailProvider } from "@le/email";
import type { Env } from "./config.js";
import { createEmailProvider } from "./email.js";

export interface WorkerContext {
  db: Db;
  linkedin: LinkedInProvider;
  email: EmailProvider | null;
  env: Env;
  /** Agent context bound to a workspace so usage is attributed correctly. */
  agentsFor(workspaceId: string): AgentContext;
}

export function createWorkerContext(env: Env): WorkerContext {
  const db = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const client = createLlmClient(env);

  const linkedin: LinkedInProvider =
    env.LINKEDIN_PROVIDER === "mock"
      ? new MockLinkedInProvider()
      : new UnipileProvider({
          dsn: env.UNIPILE_DSN,
          accessToken: env.UNIPILE_ACCESS_TOKEN,
          webhookSecret: env.UNIPILE_WEBHOOK_SECRET,
        });

  return {
    db,
    linkedin,
    email: createEmailProvider(env),
    env,
    agentsFor(workspaceId: string): AgentContext {
      return {
        client,
        async onUsage(usage) {
          // Usage logging must never fail a job: a lost cost row is cheaper
          // than a retried LinkedIn action.
          const { error } = await db.from("llm_calls").insert({
            workspace_id: workspaceId,
            agent: usage.agent,
            model: usage.model,
            prompt_version: usage.promptVersion,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cache_read_tokens: usage.cacheReadTokens,
            latency_ms: usage.latencyMs,
            // Priced here rather than at read time: the rates change, and what
            // a call cost is a fact about the day it ran.
            cost_usd: estimateCostUsd({
              model: usage.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
            }),
            error: usage.error ?? null,
          });
          if (error) console.error("failed to record llm usage", error.message);
        },
      };
    },
  };
}

export async function recordEvent(
  db: Db,
  input: {
    workspaceId: string;
    name: string;
    actorUserId?: string | null;
    subjectType?: string;
    subjectId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("events").insert({
    workspace_id: input.workspaceId,
    name: input.name,
    actor_user_id: input.actorUserId ?? null,
    subject_type: input.subjectType ?? null,
    subject_id: input.subjectId ?? null,
    payload: (input.payload ?? {}) as never,
  });
  if (error) console.error("failed to record event", input.name, error.message);
}
