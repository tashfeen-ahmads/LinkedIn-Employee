import {
  MockEmailProvider,
  ResendProvider,
  signUnsubscribeToken,
  unsubscribeUrl,
  type EmailMessage,
  type EmailProvider,
} from "@le/email";
import type { Db } from "@le/db";
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

/**
 * Lifecycle and announcement mail is marketing; the rest is not. The opt-out
 * applies to exactly these two kinds and to nothing else — a paused-account
 * alert somebody unsubscribed from is a campaign that silently stopped.
 */
export type EmailKind = "transactional" | "lifecycle" | "announcement" | "admin";
const MARKETING: ReadonlySet<EmailKind> = new Set(["lifecycle", "announcement"]);

export function isMarketing(kind: EmailKind): boolean {
  return MARKETING.has(kind);
}

/**
 * The unsubscribe link for one person, or null when this deployment cannot
 * sign one — in which case no marketing email may be sent to them at all,
 * because an email with a dead way out is worse than no email.
 */
export function unsubscribeLinkFor(env: Pick<Env, "APP_URL" | "INTERNAL_API_SECRET">, userId: string): string | null {
  const token = signUnsubscribeToken(userId, env.INTERNAL_API_SECRET);
  return token ? unsubscribeUrl(env.APP_URL, token) : null;
}

export type SendOnceOutcome =
  /** Delivered to the provider, and recorded. */
  | "sent"
  /** This user already has this step. The never-twice guard, working. */
  | "already_sent"
  /** Marketing to somebody who unsubscribed. Not sent, not recorded. */
  | "opted_out"
  /** No provider configured. Nothing recorded, so a later run may send it. */
  | "no_provider"
  /** The provider refused. The claim is released so a later run may retry. */
  | "failed";

/**
 * Sends one email at most once per (user, step), ever.
 *
 * The order is the guarantee. The row in `email_sends` is written **before**
 * the send, and `(user_id, step)` is unique — so two runs racing for the same
 * step cannot both claim it, a retried job finds the claim and stops, and the
 * second press of a button is a conflict rather than a second email. Checking
 * for a row and then sending would be a read-then-write race, and the person
 * who loses it gets two copies.
 *
 * Any failure to write the claim is read as "do not send": a table that is
 * missing or unreachable must not turn into an email sent with no record of
 * it, because the next run would then send it again.
 *
 * The opt-out is read immediately before the send rather than when the run
 * started, for the same reason the exclusion list is read immediately before a
 * LinkedIn invitation (rule 14): somebody who clicked unsubscribe at 10:00
 * must not receive the 10:05 email.
 */
export async function sendOnce(
  db: Db,
  provider: EmailProvider | null,
  input: { userId: string; step: string; kind: EmailKind; message: EmailMessage; recipient?: string },
): Promise<SendOnceOutcome> {
  if (!provider) return "no_provider";

  if (isMarketing(input.kind)) {
    const { data: profile, error } = await db
      .from("profiles")
      .select("marketing_opt_out_at")
      .eq("id", input.userId)
      .maybeSingle();
    // Unknowable is not permission. A failed read sends nothing.
    if (error || !profile) return "opted_out";
    if (profile.marketing_opt_out_at) return "opted_out";
  }

  const { data: claim, error: claimError } = await db
    .from("email_sends")
    .insert({
      user_id: input.userId,
      step: input.step,
      kind: input.kind,
      recipient: input.recipient ?? input.message.to,
      status: "claimed",
    })
    .select("id")
    .maybeSingle();
  if (claimError || !claim) return "already_sent";

  try {
    const { id } = await provider.send(input.message);
    await db
      .from("email_sends")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: id })
      .eq("id", claim.id);
    return "sent";
  } catch (error) {
    console.error(`email ${input.step} to ${input.message.to} failed:`, error);
    // Released, so the next run inside the step's window can try again. A
    // claim left behind here would turn one bad minute at the provider into a
    // step this person never receives.
    await db.from("email_sends").delete().eq("id", claim.id);
    return "failed";
  }
}
