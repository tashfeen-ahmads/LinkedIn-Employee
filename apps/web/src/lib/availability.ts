import "server-only";
import { isValidTimezone } from "@le/shared";
import type { createClient } from "@/lib/supabase-server";

/**
 * When a rep will take a meeting, read and saved in one definition.
 *
 * Two screens set it: onboarding's hours step, where a new customer says when
 * prospects may book them, and the Meetings page. The times the agent offers
 * come from this row and nothing else (rule 6), so the two must refuse the
 * same things in the same words and write the same shape — a second copy is
 * how one of them comes to save hours the slot finder cannot read.
 *
 * Deliberately separate from sending hours: when someone is willing to send
 * invitations and when they are willing to take a call are different
 * questions (migration 0012).
 */
export interface AvailabilityInput {
  timezone: string;
  start: number;
  end: number;
  days: number[];
  meetingMinutes: number;
  minNoticeHours: number;
  bufferMinutes: number;
  maxPerDay: number;
  location: string | null;
}

/** The same defaults the table carries, for whatever a form leaves out. */
export const AVAILABILITY_DEFAULTS = {
  start: 9,
  end: 17,
  days: [1, 2, 3, 4, 5],
  meetingMinutes: 30,
  minNoticeHours: 12,
  bufferMinutes: 15,
  maxPerDay: 3,
} as const;

/** Why these values cannot be saved, in words for the screen, or null. */
export function availabilityProblem(input: AvailabilityInput): string | null {
  const { start, end, days, meetingMinutes, minNoticeHours, bufferMinutes, maxPerDay } = input;
  // Every offered time is computed in this zone, and one the runtime cannot
  // read ("Eastern", "EST+1") makes the slot finder throw: no times offered,
  // and the Meetings page itself down. Refused at the door, in words.
  if (!isValidTimezone(input.timezone)) {
    return "Pick your timezone from the list. That one is not a zone the calendar can read.";
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end <= start) {
    return "Meeting hours need a start before an end, between 0 and 24.";
  }
  if (days.length === 0) return "Pick at least one day, or nothing can ever be booked.";
  if (!(meetingMinutes >= 10 && meetingMinutes <= 240)) return "A meeting is between 10 and 240 minutes.";
  if (!(minNoticeHours >= 0 && minNoticeHours <= 336)) return "Notice is between 0 and 336 hours.";
  if (!(bufferMinutes >= 0 && bufferMinutes <= 120)) return "A buffer is between 0 and 120 minutes.";
  if (!(maxPerDay >= 1 && maxPerDay <= 20)) return "Between 1 and 20 meetings a day.";
  return null;
}

/** Writes the row the slot finder reads, and says whether it landed. */
export async function saveAvailability(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
  input: AvailabilityInput,
): Promise<boolean> {
  // Checked here as well, because this is the write every caller shares: a
  // caller that skipped `availabilityProblem` must not store a zone that
  // takes the slot finder down.
  if (!isValidTimezone(input.timezone)) return false;
  const { data, error } = await supabase
    .from("availability")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        timezone: input.timezone.trim() || "UTC",
        working_hours: { start: input.start, end: input.end, days: input.days } as never,
        meeting_minutes: input.meetingMinutes,
        min_notice_hours: input.minNoticeHours,
        buffer_minutes: input.bufferMinutes,
        max_per_day: input.maxPerDay,
        location: input.location?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    )
    .select("id");
  if (error) console.error(`[availability] save: ${error.message}`);
  return Boolean(data?.length);
}

/**
 * A new profile timezone, carried onto this person's meeting hours.
 *
 * Availability falls back to the profile's zone until it is saved (rule 65),
 * and once saved it kept its own for ever: a rep who corrected their zone on
 * Profile kept being offered to prospects at the old one. One zone per
 * person, so the profile's change moves the meeting row too. A row that does
 * not exist yet needs nothing, since it already reads the profile's.
 */
export async function carryTimezoneToAvailability(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
  timezone: string,
): Promise<void> {
  if (!isValidTimezone(timezone)) return;
  const { error } = await supabase
    .from("availability")
    .update({ timezone: timezone.trim(), updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) console.error(`[availability] carry timezone: ${error.message}`);
}
