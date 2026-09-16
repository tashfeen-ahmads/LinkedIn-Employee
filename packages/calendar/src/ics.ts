/**
 * An iCalendar invitation, built by hand.
 *
 * Every mail client understands this format, so it is what turns a row in our
 * database into something that appears in the prospect's actual diary with a
 * reminder attached. Without it an "own calendar" is a booking the other person
 * has no record of, which is worse than no booking at all — they do not turn up
 * and nobody knows why.
 */

export interface IcsEvent {
  uid: string;
  startsAt: string;
  endsAt: string;
  summary: string;
  description?: string;
  location?: string;
  organizer: { name?: string; email: string };
  attendees: Array<{ name?: string; email: string }>;
  /** Bumped on every change, or clients ignore the update. */
  sequence?: number;
  cancelled?: boolean;
}

export function buildIcs(event: IcsEvent): string {
  const method = event.cancelled ? "CANCEL" : "REQUEST";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LinkedIn Employee//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER${event.organizer.name ? `;CN=${escapeParam(event.organizer.name)}` : ""}:mailto:${event.organizer.email}`,
    ...event.attendees.map(
      (a) =>
        `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${
          a.name ? `;CN=${escapeParam(a.name)}` : ""
        }:mailto:${a.email}`,
    ),
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);

  if (!event.cancelled) {
    // Fifteen minutes is the convention, and a meeting nobody is reminded of is
    // a meeting one side forgets.
    lines.push(
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.summary)}`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  // CRLF, and folded at 75 octets: both are required by RFC 5545, and Outlook
  // in particular rejects a file that ignores either.
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** UTC basic format, which is what DTSTART takes without a TZID parameter. */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`not a datetime: ${iso}`);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Backslash, semicolon, comma and newline all mean something in a property
 * value. A company called "Smith, Jones & Co" silently truncates the summary
 * at the comma otherwise.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Parameter values are quoted instead, and may not contain a quote at all. */
function escapeParam(value: string): string {
  return `"${value.replace(/["\\]/g, "").replace(/\r?\n/g, " ")}"`;
}

/** Long lines are continued with CRLF and a single leading space. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
}
