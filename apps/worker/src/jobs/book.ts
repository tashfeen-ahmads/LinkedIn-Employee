import { randomBytes } from "node:crypto";
import { buildIcs, formatSlot } from "@le/calendar";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { offerSlots, resolveCalendar } from "../calendar.js";
import { trySend } from "../email.js";

const LINK_TTL_DAYS = 14;

/**
 * Booking by link: the prospect picks the time themselves.
 *
 * The Reply Agent's own path — offer three times, read the reply, book the one
 * they accepted — is the better experience when it works, and it stays. This is
 * for everything it cannot do: a prospect who asks for "something next week", a
 * conversation where nobody names a day, a reply the acceptance matcher refuses
 * because it is ambiguous. Those used to become a hold for a human, which is a
 * meeting that happens three days later or not at all.
 *
 * The token is the whole authorisation, so it carries the prospect with it. A
 * public "book time with me" page would let anyone fill a rep's week and would
 * arrive at a booking with no idea who made it.
 */

export interface BookingPageSlot {
  iso: string;
  readable: string;
}

export interface BookingPage {
  repName: string | null;
  prospectFirstName: string | null;
  meetingMinutes: number;
  timezone: string;
  location: string | null;
  slots: BookingPageSlot[];
  /** Set when the link cannot be used, in words for the person holding it. */
  unavailable?: string;
  alreadyBookedFor?: string;
}

export async function createBookingLink(
  ctx: WorkerContext,
  input: { workspaceId: string; repUserId: string; prospectId: string; conversationId?: string | null },
): Promise<string | null> {
  // 32 bytes, url-safe. This is a bearer credential sitting in a LinkedIn
  // message: it has to be unguessable, and it must not be something a person
  // could mistype their way into.
  const token = randomBytes(32).toString("base64url");
  const { error } = await ctx.db.from("booking_links").insert({
    workspace_id: input.workspaceId,
    rep_user_id: input.repUserId,
    prospect_id: input.prospectId,
    conversation_id: input.conversationId ?? null,
    token,
    expires_at: new Date(Date.now() + LINK_TTL_DAYS * 86_400_000).toISOString(),
  });
  if (error) {
    console.error("could not create booking link", error);
    return null;
  }
  return `${ctx.env.APP_URL}/book/${token}`;
}

/** What the booking page shows. Never throws: the page has to render something. */
export async function readBookingPage(ctx: WorkerContext, token: string): Promise<BookingPage> {
  const empty: BookingPage = {
    repName: null,
    prospectFirstName: null,
    meetingMinutes: 30,
    timezone: "UTC",
    location: null,
    slots: [],
  };

  const link = await loadLink(ctx, token);
  if ("problem" in link) return { ...empty, unavailable: link.problem };

  const [{ data: rep }, { data: prospect }] = await Promise.all([
    ctx.db.from("profiles").select("full_name, timezone").eq("id", link.row.rep_user_id).maybeSingle(),
    ctx.db.from("prospects").select("first_name").eq("id", link.row.prospect_id).maybeSingle(),
  ]);

  if (link.row.meeting_id) {
    const { data: meeting } = await ctx.db
      .from("meetings")
      .select("starts_at")
      .eq("id", link.row.meeting_id)
      .maybeSingle();
    if (meeting) {
      return {
        ...empty,
        repName: rep?.full_name ?? null,
        prospectFirstName: prospect?.first_name ?? null,
        alreadyBookedFor: formatSlot(meeting.starts_at, rep?.timezone || "UTC"),
      };
    }
  }

  const binding = await resolveCalendar(ctx.db, ctx.env, {
    workspaceId: link.row.workspace_id,
    userId: link.row.rep_user_id,
    timezone: rep?.timezone || "UTC",
  });
  if (!binding) {
    return { ...empty, unavailable: "This link is not able to show times right now." };
  }

  // Six rather than the three a message carries: a page can show a choice, and
  // a prospect offered one day they cannot do has nothing to click.
  const offer = await offerSlots(binding, { maxSlots: 6 });

  return {
    repName: rep?.full_name ?? null,
    prospectFirstName: prospect?.first_name ?? null,
    meetingMinutes: binding.rules.meetingMinutes,
    timezone: binding.timezone,
    location: binding.rules.location,
    slots: offer.iso.map((iso, i) => ({ iso, readable: offer.readable[i] ?? iso })),
  };
}

export interface BookResult {
  ok: boolean;
  error?: string;
  when?: string;
}

/** Books the chosen slot, or explains why it could not. */
export async function bookFromLink(
  ctx: WorkerContext,
  input: { token: string; startsAt: string; name: string; email: string },
): Promise<BookResult> {
  const link = await loadLink(ctx, input.token);
  if ("problem" in link) return { ok: false, error: link.problem };

  const { data: rep } = await ctx.db
    .from("profiles")
    .select("full_name, email, timezone")
    .eq("id", link.row.rep_user_id)
    .maybeSingle();

  const binding = await resolveCalendar(ctx.db, ctx.env, {
    workspaceId: link.row.workspace_id,
    userId: link.row.rep_user_id,
    timezone: rep?.timezone || "UTC",
  });
  if (!binding) return { ok: false, error: "That time could not be booked. Please reply to the message instead." };

  // The time has to be one we offered, checked again now. The list the page
  // rendered is minutes old, and a slot that was free then may not be — and an
  // unchecked `startsAt` from a form is an invitation to book 3am on a Sunday.
  const offer = await offerSlots(binding, { maxSlots: 6 });
  if (!offer.iso.includes(input.startsAt)) {
    return { ok: false, error: "That time has just been taken. Please pick another." };
  }

  const endsAt = new Date(Date.parse(input.startsAt) + binding.rules.meetingMinutes * 60_000).toISOString();
  const { data: prospect } = await ctx.db
    .from("prospects")
    .select("first_name, last_name, company, linkedin_url")
    .eq("id", link.row.prospect_id)
    .maybeSingle();
  const prospectName = `${prospect?.first_name ?? ""} ${prospect?.last_name ?? ""}`.trim() || input.name;

  const { data: meeting, error } = await ctx.db
    .from("meetings")
    .insert({
      workspace_id: link.row.workspace_id,
      prospect_id: link.row.prospect_id,
      conversation_id: link.row.conversation_id,
      rep_user_id: link.row.rep_user_id,
      starts_at: input.startsAt,
      ends_at: endsAt,
      calendar_event_id: null,
      status: "scheduled",
      attendee_name: input.name,
      attendee_email: input.email,
      booked_via: "link",
    })
    .select("id")
    .single();

  if (error || !meeting) {
    // The unique index doing its job. Two people opened the same slot and one
    // of them wrote first; the loser is told to pick again rather than being
    // quietly put in the same half hour.
    console.error("booking insert failed", error);
    return { ok: false, error: "That time has just been taken. Please pick another." };
  }

  await ctx.db
    .from("booking_links")
    .update({ meeting_id: meeting.id, used_at: new Date().toISOString() })
    .eq("id", link.row.id);

  await ctx.db
    .from("campaign_prospects")
    .update({ status: "meeting_booked", closed_at: new Date().toISOString(), next_action_at: null })
    .eq("prospect_id", link.row.prospect_id)
    .in("status", ["replied", "positive", "accepted", "messaged_1", "messaged_2", "messaged_3"]);

  const when = formatSlot(input.startsAt, binding.timezone);
  await recordEvent(ctx.db, {
    workspaceId: link.row.workspace_id,
    name: "meeting.booked",
    subjectType: "prospect",
    subjectId: link.row.prospect_id,
    payload: { startsAt: input.startsAt, readable: when, via: "link" },
  });

  await sendInvites(ctx, {
    startsAt: input.startsAt,
    endsAt,
    meetingId: meeting.id,
    summary: `${prospectName}${prospect?.company ? ` (${prospect.company})` : ""} · intro call`,
    location: binding.rules.location,
    repName: rep?.full_name ?? null,
    repEmail: rep?.email ?? null,
    attendeeName: input.name,
    attendeeEmail: input.email,
    linkedinUrl: prospect?.linkedin_url ?? null,
  });

  return { ok: true, when };
}

/**
 * The invitation both sides actually get.
 *
 * Without this an own calendar is a row in our database that the prospect has
 * no record of — they do not turn up, and nobody finds out why. The .ics is
 * what puts it in their real diary with a reminder on it.
 */
async function sendInvites(
  ctx: WorkerContext,
  input: {
    startsAt: string;
    endsAt: string;
    meetingId: string;
    summary: string;
    location: string | null;
    repName: string | null;
    repEmail: string | null;
    attendeeName: string;
    attendeeEmail: string;
    linkedinUrl: string | null;
  },
): Promise<void> {
  if (!ctx.email || !input.repEmail) return;

  const ics = buildIcs({
    uid: `${input.meetingId}@linkedin-employee`,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    summary: input.summary,
    description: input.linkedinUrl ? `LinkedIn: ${input.linkedinUrl}` : undefined,
    location: input.location ?? undefined,
    organizer: { name: input.repName ?? undefined, email: input.repEmail },
    attendees: [{ name: input.attendeeName, email: input.attendeeEmail }],
  });

  const body = [
    `${input.summary}`,
    "",
    `When: ${new Date(input.startsAt).toUTCString()}`,
    input.location ? `Where: ${input.location}` : "",
    "",
    "The invitation is attached — opening it adds the meeting to your calendar.",
  ]
    .filter(Boolean)
    .join("\n");

  // Both sides, one call each. A failure to email must not undo a booking that
  // is already in the database and already the prospect's expectation.
  for (const to of [input.repEmail, input.attendeeEmail]) {
    await trySend(ctx.email, {
      to,
      subject: `Confirmed: ${input.summary}`,
      text: body,
      html: `<p>${escapeHtml(input.summary)}</p><p>${escapeHtml(new Date(input.startsAt).toUTCString())}</p>${
        input.location ? `<p>${escapeHtml(input.location)}</p>` : ""
      }<p>The invitation is attached &mdash; opening it adds the meeting to your calendar.</p>`,
      attachments: [{ filename: "invite.ics", content: ics, contentType: "text/calendar; method=REQUEST" }],
    });
  }
}

type LoadedLink =
  | { row: { id: string; workspace_id: string; rep_user_id: string; prospect_id: string; conversation_id: string | null; meeting_id: string | null } }
  | { problem: string };

/**
 * A token, checked. Every refusal says the same kind of thing to whoever is
 * holding the link and nothing at all about whether the token was real, so this
 * cannot be used to find out which tokens exist.
 */
async function loadLink(ctx: WorkerContext, token: string): Promise<LoadedLink> {
  if (!token || token.length < 20) return { problem: "This booking link is not valid." };

  const { data } = await ctx.db
    .from("booking_links")
    .select("id, workspace_id, rep_user_id, prospect_id, conversation_id, meeting_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (!data) return { problem: "This booking link is not valid." };
  if (data.revoked_at) return { problem: "This booking link has been withdrawn." };
  if (Date.parse(data.expires_at) < Date.now()) {
    return { problem: "This booking link has expired. Reply to the message and we will send another." };
  }
  return { row: data };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
