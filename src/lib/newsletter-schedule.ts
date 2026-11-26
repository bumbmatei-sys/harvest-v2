import { fromLocalInput, toLocalInput } from "./event-view";

/** Server limits, mirrored for the screen: a review lasts 10 minutes and a schedule may be at most 60 days ahead. */
export const NEWSLETTER_SCHEDULE_HORIZON_MS = 60 * 24 * 60 * 60_000;

const pad = (value: number) => String(Math.trunc(value)).padStart(2, "0");

/**
 * The schedule the server expects for a `datetime-local` value (`YYYY-MM-DDTHH:mm`) read in the ministry's zone: seconds plus the zone's own
 * offset at that instant, for example `2026-12-06T09:00:00-06:00`. Null when the value is not a date or the wall time does not exist in the
 * zone (clocks go forward over it). When clocks go back the earlier of the two instants is used.
 */
export function zonedSchedule(local: string, timeZone: string): { at: string; timezone: string } | null {
  const instant = fromLocalInput(local, timeZone);
  if (!instant) return null;
  let ms = Date.parse(instant);
  // Prefer the earlier instant of a repeated hour: one hour before shows the same wall time only in a fall-back overlap.
  if (toLocalInput(new Date(ms - 3_600_000).toISOString(), timeZone) === local) ms -= 3_600_000;
  if (toLocalInput(new Date(ms).toISOString(), timeZone) !== local) return null;
  const wall = Date.parse(`${local}:00Z`), offset = Math.round((wall - ms) / 60_000);
  const sign = offset < 0 ? "-" : "+", abs = Math.abs(offset);
  return { at: `${local}:00${sign}${pad(abs / 60)}:${pad(abs % 60)}`, timezone: timeZone };
}

/** The `datetime-local` value of an instant in the zone. */
export const scheduleInputValue = (iso: string | Date, timeZone: string) => toLocalInput(new Date(iso).toISOString(), timeZone);

/** The instant in the reader's words, in the ministry's zone ("Sun, Dec 6, 2026, 9:00 AM"). */
export function formatScheduled(iso: string | Date, timeZone: string, locale = "en") {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch { return new Date(iso).toISOString(); }
}
