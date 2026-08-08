import type { EventRecord, ProgramSession } from "../shared/domain";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface EventDayOption {
  key: string;
  anchor: string;
  weekday: string;
  day: string;
  label: string;
}

function validDate(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Choose a valid date and time.");
  return date;
}

function zonedParts(value: string | number | Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(validDate(value));
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    second: number("second"),
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function inclusiveEnd(event: Pick<EventRecord, "startsAt" | "endsAt">) {
  const start = validDate(event.startsAt);
  const end = validDate(event.endsAt);
  return end > start ? new Date(end.getTime() - 1) : end;
}

export function eventDateKey(value: string | number | Date, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function instantToDateTimeLocal(value: string, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function dateTimeLocalToInstant(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid local date and time.");
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
  const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
  let instant = desiredAsUtc;
  for (let pass = 0; pass < 4; pass += 1) {
    const observed = zonedParts(instant, timeZone);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const correction = desiredAsUtc - observedAsUtc;
    instant += correction;
    if (correction === 0) break;
  }
  const result = new Date(instant).toISOString();
  if (instantToDateTimeLocal(result, timeZone) !== value) {
    throw new Error("That local time does not exist in the selected timezone.");
  }
  return result;
}

export function formatEventDateRange(event: Pick<EventRecord, "startsAt" | "endsAt" | "timezone">) {
  const start = zonedParts(event.startsAt, event.timezone);
  const end = zonedParts(inclusiveEnd(event), event.timezone);
  const monthName = (month: number) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, month - 1, 1)));
  if (start.year === end.year && start.month === end.month && start.day === end.day) {
    return `${monthName(start.month)} ${start.day}, ${start.year}`;
  }
  if (start.year === end.year && start.month === end.month) {
    return `${monthName(start.month)} ${start.day}–${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    return `${monthName(start.month)} ${start.day} – ${monthName(end.month)} ${end.day}, ${start.year}`;
  }
  return `${monthName(start.month)} ${start.day}, ${start.year} – ${monthName(end.month)} ${end.day}, ${end.year}`;
}

export function formatEventTicket(event: Pick<EventRecord, "startsAt" | "endsAt" | "timezone">) {
  const start = zonedParts(event.startsAt, event.timezone);
  const end = zonedParts(inclusiveEnd(event), event.timezone);
  const month = (value: string | number | Date) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone: event.timezone }).format(validDate(value)).toUpperCase();
  if (start.year === end.year && start.month === end.month && start.day === end.day) return `${start.day} ${month(event.startsAt)} ${start.year}`;
  if (start.year === end.year && start.month === end.month) return `${start.day}—${end.day} ${month(event.startsAt)} ${start.year}`;
  if (start.year === end.year) return `${start.day} ${month(event.startsAt)}—${end.day} ${month(inclusiveEnd(event))} ${start.year}`;
  return `${start.day} ${month(event.startsAt)} ${start.year}—${end.day} ${month(inclusiveEnd(event))} ${end.year}`;
}

export function formatEventTime(value: string | undefined, timeZone: string) {
  if (!value) return "TBA";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(validDate(value));
}

export function formatEventDay(value: string, timeZone: string, weekday: "short" | "long" = "long") {
  return new Intl.DateTimeFormat("en-US", {
    weekday,
    month: "long",
    day: "numeric",
    timeZone,
  }).format(validDate(value));
}

export function formatEventYear(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(validDate(value));
}

export function formatShortDate(value: string | number | Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", timeZone })
    .format(validDate(value))
    .toUpperCase();
}

export function formatEventDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(validDate(value));
}

export function timeZoneAbbreviation(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(validDate(value));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

export function eventDayOptions(
  event: Pick<EventRecord, "startsAt" | "endsAt" | "timezone">,
  sessions: Pick<ProgramSession, "startsAt">[] = [],
): EventDayOption[] {
  const days = new Map<string, string>();
  const start = validDate(event.startsAt);
  const end = inclusiveEnd(event);
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 12 * 60 * 60_000) {
    const iso = new Date(cursor).toISOString();
    const key = eventDateKey(iso, event.timezone);
    if (!days.has(key)) days.set(key, iso);
  }
  const endIso = end.toISOString();
  if (!days.has(eventDateKey(endIso, event.timezone))) days.set(eventDateKey(endIso, event.timezone), endIso);
  for (const session of sessions) {
    if (!session.startsAt) continue;
    const key = eventDateKey(session.startsAt, event.timezone);
    if (!days.has(key)) days.set(key, session.startsAt);
  }
  const eventStartLocal = instantToDateTimeLocal(event.startsAt, event.timezone).slice(11);
  return [...days.keys()].sort().map((key) => {
    let anchor = days.get(key)!;
    try {
      anchor = dateTimeLocalToInstant(`${key}T${eventStartLocal}`, event.timezone);
    } catch {
      // A timezone transition can erase the event's usual wall-clock start; retain a valid instant on that day.
    }
    const representative = days.get(key)!;
    return {
      key,
      anchor,
      weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: event.timezone }).format(validDate(representative)).toUpperCase(),
      day: new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: event.timezone }).format(validDate(representative)),
      label: formatEventDay(representative, event.timezone),
    };
  });
}

export function scheduleSlotStarts(
  event: Pick<EventRecord, "startsAt" | "endsAt" | "timezone">,
  day: EventDayOption,
  sessions: Pick<ProgramSession, "startsAt">[],
  maximumSlots = 48,
) {
  const instants = new Set<number>();
  const anchor = validDate(day.anchor).getTime();
  const eventEnd = validDate(event.endsAt).getTime();
  const eventEndLocalTime = instantToDateTimeLocal(event.endsAt, event.timezone).slice(11);
  const [year, month, date] = day.key.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, date + 1));
  const nextDayKey = [
    nextDate.getUTCFullYear(),
    String(nextDate.getUTCMonth() + 1).padStart(2, "0"),
    String(nextDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
  let dayEnd = Math.min(eventEnd, anchor + 24 * 60 * 60_000);
  try {
    let localDayEnd = validDate(dateTimeLocalToInstant(`${day.key}T${eventEndLocalTime}`, event.timezone)).getTime();
    if (localDayEnd <= anchor) {
      localDayEnd = validDate(dateTimeLocalToInstant(`${nextDayKey}T${eventEndLocalTime}`, event.timezone)).getTime();
    }
    dayEnd = Math.min(eventEnd, localDayEnd);
  } catch {
    // A timezone transition can skip the configured wall-clock end; the 24-hour cap remains a safe fallback.
  }
  for (let index = 0; index < maximumSlots; index += 1) {
    const instant = anchor + index * 30 * 60_000;
    if (instant + 30 * 60_000 > dayEnd) break;
    instants.add(instant);
  }
  for (const session of sessions) {
    if (session.startsAt && eventDateKey(session.startsAt, event.timezone) === day.key) {
      instants.add(validDate(session.startsAt).getTime());
    }
  }
  return [...instants].sort((a, b) => a - b).map((instant) => new Date(instant).toISOString());
}

export function addMinutes(value: string, minutes: number) {
  return new Date(validDate(value).getTime() + minutes * 60_000).toISOString();
}
