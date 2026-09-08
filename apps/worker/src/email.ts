import { MockEmailProvider, ResendProvider, type EmailMessage, type EmailProvider } from "@le/email";
import type { Env } from "./config.js";

export function createEmailProvider(env: Env): EmailProvider | null {
  if (env.EMAIL_PROVIDER === "mock") return new MockEmailProvider();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return null;
  return new ResendProvider({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
  });
}

/**
 * Sends and swallows. Email is a notification channel, never a step a job
 * depends on: a failed digest must not retry a job that would then re-send a
 * LinkedIn message.
 */
export async function trySend(provider: EmailProvider | null, message: EmailMessage): Promise<boolean> {
  if (!provider) return false;
  try {
    await provider.send(message);
    return true;
  } catch (error) {
    console.error(`email to ${message.to} failed:`, error);
    return false;
  }
}
