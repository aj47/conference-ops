export interface CalendarInviteInput {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName: string;
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function utc(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const character of line) {
    const next = current + character;
    if (encoder.encode(next).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = ` ${character}`;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}

export function buildCalendarInvite(input: CalendarInviteInput) {
  const status = input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Conference Ops//Program Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${escapeIcs(input.uid)}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${utc(new Date().toISOString())}`,
    `DTSTART:${utc(input.startsAt)}`,
    `DTEND:${utc(input.endsAt)}`,
    `SUMMARY:${escapeIcs(input.title)}`,
    `DESCRIPTION:${escapeIcs(input.description)}`,
    `LOCATION:${escapeIcs(input.location)}`,
    `ORGANIZER;CN=${escapeIcs(input.organizerName)}:mailto:${input.organizerEmail}`,
    `ATTENDEE;CN=${escapeIcs(input.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${input.attendeeEmail}`,
    `STATUS:${status}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export interface RawEmailInput {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  calendar?: { method: "REQUEST" | "CANCEL"; ics: string };
}

function encodeHeader(value: string) {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

export function buildRawEmail(input: RawEmailInput) {
  const mixedBoundary = `conference-ops-${crypto.randomUUID()}`;
  const alternativeBoundary = `alternative-${crypto.randomUUID()}`;
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Reply-To: ${input.replyTo}`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@conference-ops>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
  ];
  const body = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
    `--${alternativeBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html,
    `--${alternativeBoundary}--`,
  ];
  if (input.calendar) {
    body.push(
      `--${mixedBoundary}`,
      `Content-Type: text/calendar; charset=UTF-8; method=${input.calendar.method}`,
      "Content-Transfer-Encoding: 8bit",
      "Content-Disposition: inline; filename=invite.ics",
      "",
      input.calendar.ics,
    );
  }
  body.push(`--${mixedBoundary}--`, "");
  return [...headers, ...body].join("\r\n");
}
