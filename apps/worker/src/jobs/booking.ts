import { BRAND } from "@le/shared";
import { formatSlot } from "@le/calendar";
import { firstMeetingEmail } from "@le/email";
import { slotStillFree, type CalendarBinding } from "../calendar.js";
import type { WorkerContext } from "../context.js";
import { trySend } from "../email.js";
import { flagForHuman } from "../holds.js";
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
  /** The hours the slots were offered within, when the caller had its own. */
  workingHours?: { start: number; end: number; days: number[] };
}

/**
 * What happened to an acceptance.
 *
 * `held` is the case the caller must not treat as "nothing to book": the
 * prospect accepted a time, we could not put it in a diary, and a booking hold
 * now says so. A reply drafted after that has to wait for the same person,
 * because it was written without knowing the meeting did not happen.
 */
export type BookingOutcome =
  | { status: "booked"; meetingId: string }
  | { status: "no_match" }
  | { status: "held"; reason: string };

/**
 * Books a meeting when a prospect accepts one of the times we offered.
 *
 * The match is deliberately narrow: we only ever book a slot that appears in
 * offeredSlots. A prospect proposing their own time is a hand-off to the rep,
 * not something to guess at.
 */
export async function tryBookMeeting(ctx: WorkerContext, input: BookingInput): Promise<string | null> {
  const outcome = await bookAcceptedSlot(ctx, input);
  return outcome.status === "booked" ? outcome.meetingId : null;
}

export async function bookAcceptedSlot(ctx: WorkerContext, input: BookingInput): Promise<BookingOutcome> {
  // No separate empty-list guard: matchOfferedSlot returns null for an empty
  // list, and this is the check that stops everything. One gate, testable.
  const chosen = matchOfferedSlot(input.message, input.offeredSlots, input.binding.timezone);
  if (!chosen) return { status: "no_match" };
  const readable = formatSlot(chosen, input.binding.timezone);

  /*
   * Asked again now, not trusted from the offer.
   *
   * The slots on a draft can be days old. Another prospect may have taken that
   * half hour through a booking link, the rep may have blocked the afternoon,
   * or the day may have reached its cap — and booking it anyway puts two people
   * in one call, which the person who loses finds out about by turning up
   * (rule 18). `bookFromLink` re-derives its list for the same reason.
   */
  const free = await slotStillFree(input.binding, chosen, {
    durationMinutes: input.durationMinutes,
    workingHours: input.workingHours,
  });
  if (!free) {
    const reason = `They accepted ${readable}, which is no longer free. Offer them another time.`;
    await flagForHuman(ctx.db, input.conversationId, reason, "booking");
    return { status: "held", reason };
  }

  const { data: prospect } = await ctx.db
    .from("prospects")
    .select("first_name, last_name, company, linkedin_url")
    .eq("id", input.prospectId)
    .single();
  const { data: rep } = await ctx.db
    .from("profiles")
    .select("email, full_name")
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
          `Booked by ${BRAND.name} on behalf of ${rep?.full_name ?? "you"}.`,
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
    // A booking hold, not a reply hold. Sending the reply that goes out
    // moments from now must not clear it: the meeting still is not in anyone's
    // diary, and this flag is the only thing that says so.
    const reason = "calendar write failed, book this manually";
    await flagForHuman(ctx.db, input.conversationId, reason, "booking");
    console.error("calendar write failed", error);
    return { status: "held", reason };
  }

  const { data: meeting, error: insertError } = await ctx.db
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

  /*
   * The row is the booking. Without it nothing reports the meeting, nothing
   * treats the half hour as busy, and the prospect is still marked booked — a
   * meeting every screen believes in that nobody will attend.
   *
   * The usual cause is `meetings_one_per_rep_slot` refusing a second meeting in
   * the same half hour, which means somebody else got there first. So the
   * prospect is not marked booked and no event is recorded; the conversation is
   * held for a person instead. On a Google or Microsoft calendar the event above
   * was already written, and the reason says so, because that is now an event
   * in the rep's diary that no meeting here accounts for.
   */
  if (insertError || !meeting) {
    console.error("meeting insert failed", insertError);
    const reason = input.binding.ownOnly
      ? `They accepted ${readable}, but the meeting could not be saved, most likely because that time was just taken. Book it by hand or offer another time.`
      : `They accepted ${readable}, but the meeting could not be saved, most likely because that time was just taken. Check your calendar for the event we created, then book it by hand or offer another time.`;
    await flagForHuman(ctx.db, input.conversationId, reason, "booking");
    return { status: "held", reason };
  }

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
    payload: { startsAt: chosen, readable },
  });

  await maybeAnnounceFirstMeeting(ctx, input, {
    prospectName,
    prospectCompany: prospect?.company ?? null,
    repEmail: rep?.email ?? null,
    repName: rep?.full_name ?? null,
    when: readable,
  });

  return { status: "booked", meetingId: meeting.id as string };
}

/**
 * The first booked meeting in a workspace gets its own email.
 *
 * It is the moment the product either worked or did not, and nobody should
 * have to find that out by opening a dashboard. Only the first: after that the
 * morning digest carries them, and an email per meeting is the thing a working
 * product does to make itself annoying.
 */
async function maybeAnnounceFirstMeeting(
  ctx: WorkerContext,
  input: BookingInput,
  details: {
    prospectName: string;
    prospectCompany: string | null;
    repEmail: string | null;
    repName: string | null;
    when: string;
  },
): Promise<void> {
  if (!ctx.email || !details.repEmail) return;

  // Counted, not flagged: the meeting just inserted is the first one exactly
  // when the workspace has one. No extra column, and re-running this cannot
  // send a second copy.
  const { count } = await ctx.db
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId);
  if ((count ?? 0) !== 1) return;

  await trySend(
    ctx.email,
    firstMeetingEmail({
      to: details.repEmail,
      repName: details.repName,
      appUrl: ctx.env.APP_URL,
      prospectName: details.prospectName,
      prospectCompany: details.prospectCompany,
      when: details.when,
      theirWords: input.message.trim().slice(0, 280),
    }),
  );
}

/**
 * Decides which offered slot a reply accepts. Ordinal references ("the second
 * one") and explicit day or time mentions both work; ambiguity returns null so
 * the conversation goes to a human rather than booking the wrong hour.
 *
 * Every time a prospect states narrows the choice and none is ever ignored.
 * The version this replaced read the first number in the message and never
 * the minutes of the slot, so "Wednesday at 9:30" matched nothing and
 * "Wednesday at 9" booked the 9:30 — a different time from the one the
 * prospect wrote, in a real rep's diary (rule 6). A number it cannot place is
 * read as a time, never skipped: an unbooked acceptance costs one reply, a
 * wrong booking costs the meeting.
 */
export function matchOfferedSlot(message: string, offered: string[], timezone: string): string | null {
  if (offered.length === 0) return null;
  const text = normalise(message);
  if (!looksLikeAcceptance(text)) return null;
  // "Tomorrow" and "today" name a day we cannot check against a slot without
  // knowing when the message was written, so they are left to a person.
  if (RELATIVE_DAY.test(text)) return null;

  const stated = readMentions(text);

  // "The first one works" / "option 2" / "let's do the third".
  const ordinals: Array<[RegExp, number]> = [
    [/\b(first|option\s*#?\s*1|number\s*1)\b/, 0],
    [/\b(second|option\s*#?\s*2|number\s*2)\b/, 1],
    [/\b(third|option\s*#?\s*3|number\s*3)\b/, 2],
  ];
  const ordinalMatches = ordinals.filter(([pattern]) => pattern.test(stated.rest));
  if (ordinalMatches.length > 1) return null;
  if (ordinalMatches.length === 1) {
    const slot = offered[ordinalMatches[0]![1]];
    if (!slot) return null;
    // An ordinal that disagrees with a day or time in the same message is two
    // answers, not one.
    if (stated.days.length || stated.times.length) {
      return slotMatches(slot, stated, timezone) ? slot : null;
    }
    return slot;
  }

  // Nothing to go on but "yes": with one slot offered that is an answer, with
  // three it is a guess.
  if (!stated.days.length && !stated.times.length) return null;

  const candidates = offered.filter((slot) => slotMatches(slot, stated, timezone));
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

const RELATIVE_DAY = /\b(today|tonight|tomorrow|tmrw|tmr)\b/;

function looksLikeAcceptance(text: string): boolean {
  if (NEGATION.test(text)) return false;
  return ACCEPTANCE.test(text);
}

const WEEKDAYS: Array<[string, RegExp]> = [
  ["monday", /\bmon(day)?\b/],
  ["tuesday", /\btue(s|sday)?\b/],
  ["wednesday", /\bwed(nesday)?\b/],
  ["thursday", /\bthu(r|rs|rsday)?\b/],
  ["friday", /\bfri(day)?\b/],
  ["saturday", /\bsaturday\b/],
  ["sunday", /\bsunday\b/],
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_PATTERN =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";

interface StatedDay {
  weekday?: string;
  month?: string;
  day?: number;
}

interface StatedTime {
  hour: number;
  minute: number;
  period?: "am" | "pm";
}

interface Mentions {
  days: StatedDay[];
  times: StatedTime[];
  /** The message with every date and time taken out, for the ordinal check. */
  rest: string;
}

/** Lower case, ordinary spaces, and no time-zone names to mistake for numbers. */
function normalise(message: string): string {
  return (
    message
      .toLowerCase()
      // `formatSlot` renders "9:30 AM" with a narrow no-break space on newer
      // ICU, and a prospect pasting it back must still match.
      .replace(/[   ]/g, " ")
      .replace(/\b(a)\.m\.?|\b(p)\.m\.?/g, (_m, a, p) => (a ? "am" : "pm"))
      // "GMT+1", "UTC-05:00": an offset is not an hour.
      .replace(/\b(gmt|utc)\s*[+-]\s*\d{1,2}(:\d{2})?\b/g, " ")
  );
}

function readMentions(text: string): Mentions {
  const days: StatedDay[] = [];
  let rest = text;

  // "October 8", "Oct 8th", "8 October", "the 8th". Taken out before times are
  // read, so the 8 in "October 8 at 10" is a date and not an hour.
  const monthFirst = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g");
  rest = rest.replace(monthFirst, (_m, month: string, day: string) => {
    days.push({ month: monthName(month), day: Number(day) });
    return " ";
  });
  // Not "may" this way round: "at 10 may be best" is an hour and a verb.
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?!may\\b)${MONTH_PATTERN}`, "g");
  rest = rest.replace(dayFirst, (_m, day: string, month: string) => {
    days.push({ month: monthName(month), day: Number(day) });
    return " ";
  });
  rest = rest.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, (_m, day: string) => {
    days.push({ day: Number(day) });
    return " ";
  });
  // "10/8" could be either order. Read as neither, and left standing as
  // numbers below, so it can only ever make a match less likely.

  for (const [weekday, pattern] of WEEKDAYS) {
    if (pattern.test(rest)) {
      days.push({ weekday });
      rest = rest.replace(new RegExp(pattern.source, "g"), " ");
    }
  }

  const times: StatedTime[] = [];
  rest = rest.replace(/\bnoon\b/g, () => {
    times.push({ hour: 12, minute: 0, period: "pm" });
    return " ";
  });
  rest = rest.replace(/\bmidday\b/g, () => {
    times.push({ hour: 12, minute: 0, period: "pm" });
    return " ";
  });
  rest = rest.replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/g, (match, hour: string, minute: string | undefined, period: string | undefined, offset: number, whole: string) => {
    // "option 2" and "number 3" are ordinals, read separately.
    const before = whole.slice(Math.max(0, offset - 10), offset);
    if (/(option|number|#)\s*$/.test(before)) return match;
    times.push({
      hour: Number(hour),
      minute: minute ? Number(minute) : 0,
      period: period === "am" || period === "pm" ? period : undefined,
    });
    return " ";
  });

  return { days, times, rest };
}

function monthName(raw: string): string {
  const prefix = raw.replace(/\.$/, "").slice(0, 3);
  return MONTHS.find((month) => month.startsWith(prefix)) ?? raw;
}

/** Whether one offered slot agrees with every day and time the prospect named. */
function slotMatches(iso: string, stated: Mentions, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value?.toLowerCase() ?? "";
  const slot = {
    weekday: get("weekday"),
    month: get("month"),
    day: Number(get("day")),
    hour24: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };

  // Several days named means several answers, unless they all describe this
  // slot ("Thursday, October 8").
  for (const day of stated.days) {
    if (day.weekday && day.weekday !== slot.weekday) return false;
    if (day.month && day.month !== slot.month) return false;
    if (day.day !== undefined && day.day !== slot.day) return false;
  }

  for (const time of stated.times) {
    if (time.minute !== slot.minute) return false;
    if (time.period) {
      const hour12 = slot.hour24 % 12 === 0 ? 12 : slot.hour24 % 12;
      const period = slot.hour24 < 12 ? "am" : "pm";
      if (time.hour !== hour12 || time.period !== period) return false;
    } else if (time.hour > 12 || time.hour === 0) {
      // "14:00" is unambiguous.
      if (time.hour % 24 !== slot.hour24) return false;
    } else {
      // "at 2" is two in the afternoon or two in the morning, and only one of
      // those is ever inside somebody's working hours; either reading names
      // the same slot.
      const hour12 = slot.hour24 % 12 === 0 ? 12 : slot.hour24 % 12;
      if (time.hour !== hour12) return false;
    }
  }
  return true;
}
