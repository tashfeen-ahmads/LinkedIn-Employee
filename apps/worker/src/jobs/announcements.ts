import { announcementEmail } from "@le/email";
import { fetchAllRows, type Db } from "@le/db";
import type { WorkerContext } from "../context.js";
import { sendOnce, unsubscribeLinkFor } from "../email.js";

/**
 * Product updates an operator writes in the console and sends to everybody.
 *
 * Two guards against a second send, at two levels, because the cost of
 * getting this wrong is every customer receiving the same email twice:
 *
 * 1. **The button.** `send_requested_at` is set with `where … is null`, so the
 *    second press, the second tab and the retried request all find it taken
 *    and send nothing. That is a compare-and-set in one statement, not a read
 *    followed by a write.
 * 2. **Each person.** Every delivery claims `(user, announcement.<id>)` in
 *    `email_sends` before it goes. A send that dies half way is resumed by
 *    the hourly run and reaches only the people it had not reached yet.
 *
 * Every write here checks the caller is a platform admin, as the second lock
 * behind the shared secret: the web app already checked, and this is what
 * stops a leaked secret from mailing every customer.
 */

export const AnnouncementStepPrefix = "announcement.";

export function announcementStep(id: string): string {
  return `${AnnouncementStepPrefix}${id}`;
}

export async function isPlatformAdmin(db: Db, userId: string): Promise<boolean> {
  const { data, error } = await db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  // A failed check is a "no". The privilege is what is being asked about.
  return !error && Boolean(data);
}

export interface AnnouncementDraft {
  subject: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

/**
 * Creates or edits a draft. Refuses to edit one that has been sent: what
 * people received is a record, and rewriting it afterwards makes the console
 * lie about what went out.
 */
export async function saveAnnouncement(
  ctx: WorkerContext,
  input: { userId: string; id?: string } & AnnouncementDraft,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { db } = ctx;
  if (!(await isPlatformAdmin(db, input.userId))) return { ok: false, error: "Only a platform admin can do that." };

  const row = {
    subject: input.subject,
    body: input.body,
    cta_label: input.ctaLabel,
    cta_url: input.ctaUrl,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data: existing } = await db
      .from("announcements")
      .select("id, send_requested_at")
      .eq("id", input.id)
      .maybeSingle();
    if (!existing) return { ok: false, error: "That announcement does not exist." };
    if (existing.send_requested_at) {
      return { ok: false, error: "That announcement has already been sent, so it can no longer be edited." };
    }
    const { error } = await db.from("announcements").update(row).eq("id", input.id).is("send_requested_at", null);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: input.id };
  }

  const { data, error } = await db
    .from("announcements")
    .insert({ ...row, created_by: input.userId })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the announcement." };
  return { ok: true, id: data.id };
}

async function loadAnnouncement(db: Db, id: string) {
  const { data } = await db
    .from("announcements")
    .select("id, subject, body, cta_label, cta_url, send_requested_at, sent_at")
    .eq("id", id)
    .maybeSingle();
  return data;
}

function messageFor(
  ctx: WorkerContext,
  announcement: { subject: string; body: string; cta_label: string | null; cta_url: string | null },
  to: string,
  unsubscribeUrl: string,
) {
  return announcementEmail({
    to,
    appUrl: ctx.env.APP_URL,
    subject: announcement.subject,
    body: announcement.body,
    cta:
      announcement.cta_label && announcement.cta_url
        ? { label: announcement.cta_label, url: announcement.cta_url }
        : null,
    unsubscribeUrl,
    postalAddress: ctx.env.EMAIL_POSTAL_ADDRESS ?? null,
  });
}

/**
 * Sends the draft to the admin who asked, and only to them. Not recorded in
 * `email_sends`: a test that claimed the admin's row would stop them receiving
 * the real one.
 */
export async function sendAnnouncementTest(
  ctx: WorkerContext,
  input: { userId: string; id: string },
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const { db } = ctx;
  if (!(await isPlatformAdmin(db, input.userId))) return { ok: false, error: "Only a platform admin can do that." };
  if (!ctx.email) return { ok: false, error: "Email is not set up on this deployment, so nothing can be sent." };

  const announcement = await loadAnnouncement(db, input.id);
  if (!announcement) return { ok: false, error: "That announcement does not exist." };

  const { data: me } = await db.from("profiles").select("email").eq("id", input.userId).maybeSingle();
  if (!me?.email) return { ok: false, error: "Your account has no email address to send a test to." };

  const unsubscribeUrl = unsubscribeLinkFor(ctx.env, input.userId);
  if (!unsubscribeUrl) return { ok: false, error: "This deployment cannot sign unsubscribe links, so it sends no product email." };

  const message = messageFor(ctx, announcement, me.email, unsubscribeUrl);
  try {
    await ctx.email.send({ ...message, subject: `[Test] ${message.subject}` });
  } catch (error) {
    return { ok: false, error: `The email provider refused it: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, to: me.email };
}

/**
 * The button. Claims the announcement in one statement and reports whether
 * this call was the one that claimed it; delivery happens in a queued job.
 */
export async function requestAnnouncementSend(
  ctx: WorkerContext,
  input: { userId: string; id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db } = ctx;
  if (!(await isPlatformAdmin(db, input.userId))) return { ok: false, error: "Only a platform admin can do that." };
  if (!ctx.email) return { ok: false, error: "Email is not set up on this deployment, so nothing can be sent." };
  if (!unsubscribeLinkFor(ctx.env, input.userId)) {
    return { ok: false, error: "This deployment cannot sign unsubscribe links, so it sends no product email." };
  }

  const { data: claimed, error } = await db
    .from("announcements")
    .update({ send_requested_at: new Date().toISOString(), send_requested_by: input.userId })
    .eq("id", input.id)
    .is("send_requested_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!claimed?.length) {
    return { ok: false, error: "That announcement has already been sent. Nothing was sent again." };
  }
  return { ok: true };
}

/**
 * Delivers a claimed announcement to everybody who has not unsubscribed.
 * Safe to run any number of times: each person is claimed before they are
 * sent to, so a rerun reaches only the people the last run did not.
 */
export async function deliverAnnouncement(ctx: WorkerContext, id: string): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;

  const announcement = await loadAnnouncement(db, id);
  // Never without the button having been pressed: a job carrying an id is not
  // permission to email everybody.
  if (!announcement?.send_requested_at || announcement.sent_at) return 0;

  const { rows: people } = await fetchAllRows((from, to) =>
    db
      .from("profiles")
      .select("id, email, marketing_opt_out_at")
      .is("marketing_opt_out_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );

  let sent = 0;
  for (const person of people) {
    if (!person.email) continue;
    const unsubscribeUrl = unsubscribeLinkFor(ctx.env, person.id);
    if (!unsubscribeUrl) continue;
    const outcome = await sendOnce(db, ctx.email, {
      userId: person.id,
      step: announcementStep(id),
      kind: "announcement",
      message: messageFor(ctx, announcement, person.email, unsubscribeUrl),
    });
    if (outcome === "sent") sent += 1;
  }

  const { count } = await db
    .from("email_sends")
    .select("id", { count: "exact", head: true })
    .eq("step", announcementStep(id))
    .eq("status", "sent");
  await db
    .from("announcements")
    .update({ sent_at: new Date().toISOString(), recipients: count ?? sent })
    .eq("id", id);
  return sent;
}

/**
 * The repair loop. An announcement claimed but never finished — the queue was
 * down when the button was pressed, or the job died part way — is picked up
 * by the hourly run. Repair must not depend on somebody pressing the button
 * again, which is the one thing the button now refuses.
 */
export async function resumeAnnouncements(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;
  // Give the queued job its chance first.
  const before = new Date(now.getTime() - 10 * 60_000).toISOString();
  const { data: stalled } = await db
    .from("announcements")
    .select("id, send_requested_at")
    .is("sent_at", null)
    .not("send_requested_at", "is", null)
    .lte("send_requested_at", before);
  let sent = 0;
  for (const row of stalled ?? []) sent += await deliverAnnouncement(ctx, row.id);
  return sent;
}
