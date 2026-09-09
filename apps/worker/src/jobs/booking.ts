import { formatSlot } from "@le/calendar";
import type { CalendarBinding } from "../calendar.js";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

export interface BookingInput {
  workspaceId: string;
  conversationId: string;
  prospectId: string;
  repUserId: string;
  /** ISO datetimes we actually offered in the previous message. */
  offeredSlots: string[];
  /** The prospect's latest message. */
  message: string;
  binding: CalendarBinding;
  durationMinutes: number;
}

/**
 * Books a meeting when a prospect accepts one of the times we offered.
 *
 * The match is deliberately narrow: we only ever book a slot that appears in
 * offeredSlots. A prospect proposing their own time is a hand-off to the rep,
 * not something to guess at.
 */
export async function tryBookMeeting(ctx: WorkerContext, input: BookingInput): Promise<string | null> {
  // No separate empty-list guard: matchOfferedSlot returns null for an empty
  // list, and this is the check that stops everything. One gate, testable.
  const chosen = matchOfferedSlot(input.message, input.offeredSlots, input.binding.timezone);
  if (!chosen) return null;

  const { data: prospect } = await ctx.db
    .from("prospects")
    .select("first_name, last_name, company, linkedin_url")
    .eq("id", input.prospectId)
    .single();
  const { data: rep } = await ctx.db
    .from("profiles")
    .select("full_name")
    .eq("id", input.repUserId)
    .single();

  const prospectName = `${prospect?.first_name ?? ""} ${prospect?.last_name ?? ""}`.trim() || "LinkedIn contact";
  const endsAt = new Date(Date.parse(chosen) + input.durationMinutes * 60_000).toISOString();

  let created;
  try {
    created = await input.binding.provider.createMeeting({
      accessToken: input.binding.accessToken,
      request: {
        startsAt: chosen,
        endsAt,
        summary: `${prospectName}${prospect?.company ? ` (${prospect.company})` : ""} · intro call`,
        description: [
          `Booked by LinkedIn Employee on behalf of ${rep?.full_name ?? "you"}.`,
          prospect?.linkedin_url ? `LinkedIn: ${prospect.linkedin_url}` : "",
          "",
          "Their message:",
          input.message,
        ]
          .filter(Boolean)
          .join("\n"),
        timezone: input.binding.timezone,
      },
    });
  } catch (error) {
    // A failed calendar write must not silently drop a booked meeting: leave
    // the conversation for a human instead.
    await ctx.db
      .from("conversations")
      .update({ needs_human: true, needs_human_reason: "calendar write failed, book this manually" })
      .eq("id", input.conversationId);
    console.error("calendar write failed", error);
    return null;
  }

  const { data: meeting } = await ctx.db
    .from("meetings")
    .insert({
      workspace_id: input.workspaceId,
      prospect_id: input.prospectId,
      conversation_id: input.conversationId,
      rep_user_id: input.repUserId,
      starts_at: chosen,
      ends_at: endsAt,
      calendar_event_id: created.eventId,
      meeting_url: created.meetingUrl ?? created.htmlLink ?? null,
      status: "scheduled",
    })
    .select("id")
    .single();

  await ctx.db
    .from("campaign_prospects")
    .update({ status: "meeting_booked", closed_at: new Date().toISOString(), next_action_at: null })
    .eq("prospect_id", input.prospectId)
    .in("status", ["replied", "positive"]);

  await recordEvent(ctx.db, {
    workspaceId: input.workspaceId,
    name: "meeting.booked",
    subjectType: "conversation",
    subjectId: input.conversationId,
    payload: { startsAt: chosen, readable: formatSlot(chosen, input.binding.timezone) },
  });

  return meeting?.id ?? null;
}

/**
 * Decides which offered slot a reply accepts. Ordinal references ("the second
 * one") and explicit day or time mentions both work; ambiguity returns null so
 * the conversation goes to a human rather than booking the wrong hour.
 */
export function matchOfferedSlot(message: string, offered: string[], timezone: string): string | null {
  const text = message.toLowerCase();
  if (!looksLikeAcceptance(text)) return null;

  // "The first one works" / "option 2" / "let's do the third".
  const ordinals: Array<[RegExp, number]> = [
    [/\b(first|1st|option\s*1|number\s*1)\b/, 0],
    [/\b(second|2nd|option\s*2|number\s*2)\b/, 1],
    [/\b(third|3rd|option\s*3|number\s*3)\b/, 2],
  ];
  const ordinalMatches = ordinals.filter(([pattern]) => pattern.test(text));
  if (ordinalMatches.length === 1) {
    const index = ordinalMatches[0]![1];
    return offered[index] ?? null;
  }
  if (ordinalMatches.length > 1) return null;

  // Otherwise match on the day and, when given, the hour.
  const candidates = offered.filter((slot) => mentionsSlot(text, slot, timezone));
  return candidates.length === 1 ? candidates[0]! : null;
}

const ACCEPTANCE = /\b(works|work for me|sounds good|let'?s do|perfect|great|book|schedule|confirm|see you|yes|sure|that one|i'?ll take)\b/;

/**
 * A negation anywhere in the message disqualifies it.
 *
 * "Tuesday doesn't work for me" contains "work for me" and would otherwise
 * book the slot the prospect just declined — the worst possible outcome, since
 * the rep then shows up to a meeting the other person believes they refused.
 * Rejecting the whole message is the right trade: an unbooked acceptance costs
 * one reply, a booked refusal costs the relationship.
 */
const NEGATION = /\b(does\s?n'?t|doesn't|do\s?n'?t|don't|can'?t|cannot|won'?t|not|no longer|unable|unfortunately|instead|rather|another|different|reschedule|move)\b/;

function looksLikeAcceptance(text: string): boolean {
  if (NEGATION.test(text)) return false;
  return ACCEPTANCE.test(text);
}

function mentionsSlot(text: string, iso: string, timezone: string): boolean {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    hour12: true,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value?.toLowerCase() ?? "";
  const weekday = get("weekday");
  const day = get("day");
  const hour12 = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");

  const mentionsDay =
    (weekday.length > 0 && text.includes(weekday)) ||
    new RegExp(`\\b${day}(st|nd|rd|th)?\\b`).test(text) ||
    new RegExp(`\\b${get("month")}\\s+${day}\\b`).test(text);
  if (!mentionsDay) return false;

  // A bare day reference is enough when only one slot falls on that day; the
  // caller checks for exactly one candidate.
  const statedTime = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b(?!\s*(st|nd|rd|th))/);
  if (!statedTime) return true;

  // Minutes are compared, not ignored: "Tuesday at 3:30" must not match the
  // 3:00 slot we actually offered.
  const statedHour = statedTime[1];
  const statedMinute = statedTime[2] ?? "00";
  const statedPeriod = statedTime[3];
  if (statedHour !== hour12) return false;
  if (statedMinute !== minute.padStart(2, "0")) return false;
  if (statedPeriod && statedPeriod !== dayPeriod) return false;
  return true;
}
