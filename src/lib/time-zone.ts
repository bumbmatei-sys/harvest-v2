/**
 * Time zone helpers for ministry settings and CRM reports. Pure (Intl only), shared by the server, the screen and the tests.
 * Zones are IANA names ("Europe/Berlin"); "UTC" is the default. Day arithmetic is calendar arithmetic in the zone, so a day that
 * is 23 or 25 hours long (a daylight-saving change) still counts as one day.
 */
export const DEFAULT_TIME_ZONE = "UTC";

/** True for "UTC" or a region/city IANA name the runtime knows. Abbreviations ("EST") and offsets are refused. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) return false;
  if (value === "UTC") return true;
  if (!/^[A-Za-z]+(?:[_-][A-Za-z]+)*(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}
/** A valid zone, or UTC. */
export const timeZoneOrDefault = (value: unknown) => isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }); formatters.set(timeZone, formatter); }
  const found: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) if (part.type !== "literal") found[part.type] = Number(part.value);
  return { year: found.year!, month: found.month!, day: found.day!, hour: found.hour!, minute: found.minute!, second: found.second! };
}
/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetMs(instant: number, timeZone: string) {
  const p = parts(new Date(instant), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}
/** The calendar date (year, month 1-12, day) at an instant in the zone. */
export function zonedDate(date: Date, timeZone: string) { const { year, month, day } = parts(date, timeZone); return { year, month, day }; }
/** The first instant of a calendar day in the zone. `month` is 1-12 and may overflow; so may `day` (calendar arithmetic). */
export function zonedStartOfDay(year: number, month: number, day: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day), before = offsetMs(wall - 36 * 3_600_000, timeZone), after = offsetMs(wall + 36 * 3_600_000, timeZone);
  // The two offsets that can apply around this midnight. A candidate is real only if the zone really has that offset at that instant.
  const valid = [...new Set([before, after])].map((offset) => ({ offset, instant: wall - offset })).filter((candidate) => offsetMs(candidate.instant, timeZone) === candidate.offset);
  // Two real candidates: the midnight happens twice (clocks go back), the first one starts the day. None: the midnight does not exist
  // (clocks go forward over it), so the day starts at the change itself, which is midnight under the earlier offset.
  return new Date(valid.length ? Math.min(...valid.map((candidate) => candidate.instant)) : wall - before);
}
/** YYYY-MM-DD of an instant in the zone (file names and CSV period columns). */
export function zonedIsoDate(date: Date, timeZone: string) {
  const { year, month, day } = zonedDate(date, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** The browser's zone (sent when a ministry is created); empty if the browser cannot tell, which the server reads as UTC. */
export function browserTimeZone(): string | undefined {
  try { const zone = Intl.DateTimeFormat().resolvedOptions().timeZone; return isValidTimeZone(zone) ? zone : undefined; } catch { return undefined; }
}
/** Zones for a picker: UTC first, then the runtime's list. */
export function timeZoneChoices(current?: string): string[] {
  let list: string[] = [];
  try { list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { /* older runtime */ }
  return [...new Set([DEFAULT_TIME_ZONE, ...(current ? [current] : []), ...list])];
}
