/**
 * What a rep's own scheduling link costs the numbers (rule 31).
 *
 * A booking made on Calendly happens on Calendly: no webhook we are entitled
 * to and nothing to poll. So wherever a meeting count is shown for a rep or a
 * campaign that relies on that link, this sentence goes beside it, because a
 * zero with nothing next to it reads as a campaign that booked nobody.
 *
 * One sentence, read by every screen that needs it, so the meetings page, the
 * overview and the campaign funnel cannot each explain it differently.
 */
export const EXTERNAL_BOOKINGS_UNCOUNTED =
  "Meetings booked through your own scheduling link, such as Calendly or Cal.com, happen on that page, so they are not on the Meetings page and are not counted in your results. Check that calendar for them.";

/** Whether a profile's booking link is set to anything at all. */
export function hasOwnBookingLink(url: string | null | undefined): boolean {
  return typeof url === "string" && url.trim().length > 0;
}
