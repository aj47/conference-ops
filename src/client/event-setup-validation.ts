import { dateTimeLocalToInstant } from "./event-time";

export function cfpDeadlineValidation(cfpClosesAt: string, startsAt: string, timezone: string) {
  if (!cfpClosesAt || !startsAt) return "";
  try {
    const closeInstant = dateTimeLocalToInstant(cfpClosesAt, timezone);
    const startInstant = dateTimeLocalToInstant(startsAt, timezone);
    return new Date(closeInstant).getTime() < new Date(startInstant).getTime()
      ? ""
      : "CFP close must be before the event starts.";
  } catch {
    return "Choose a valid CFP close date and time.";
  }
}
