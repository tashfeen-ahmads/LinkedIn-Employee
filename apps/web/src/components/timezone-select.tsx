import { COMMON_TIMEZONES } from "@le/shared";

/**
 * The zone a rep's sending hours and meeting slots are read in.
 *
 * It was a free-text input in two places. A zone is an IANA identifier and
 * nothing else — "EST", "Eastern", "GMT+5" and a typo all parse to nothing, and
 * every caller falls back to UTC without saying so. That is not hypothetical:
 * this deployment ran with `UTC` on every profile, so an account whose hours
 * read "8 to 18" was inviting people in New York at four in the morning, which
 * is both useless outreach and exactly the pattern that gets an account
 * throttled.
 *
 * A list the browser itself supplies (`Intl.supportedValuesOf`) would be right
 * and 400 items long. This is the short list people actually pick from, with
 * the current time in each one so the choice is checkable rather than a guess
 * at what a label means.
 */
export function TimezoneSelect({
  name = "timezone",
  value,
  id,
}: {
  name?: string;
  value: string | null | undefined;
  id?: string;
}) {
  const current = value ?? "UTC";
  // A zone already saved that is not on the short list stays selectable, or
  // saving any other field would silently move the rep to UTC.
  const zones = COMMON_TIMEZONES.some((z) => z.id === current)
    ? COMMON_TIMEZONES
    : [{ id: current, label: current }, ...COMMON_TIMEZONES];

  return (
    <select id={id} name={name} defaultValue={current}>
      {zones.map((zone) => (
        <option key={zone.id} value={zone.id}>
          {zone.label} — {localTime(zone.id)}
        </option>
      ))}
    </select>
  );
}

/** The wall-clock time in a zone right now, so a label can be checked. */
function localTime(zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    // An identifier this runtime does not know. Say so rather than throwing a
    // whole settings page away over one row in a dropdown.
    return "unknown zone";
  }
}
