import { fromLocalInput, toLocalInput } from "@/lib/event-view";

export const browserTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
export function timeZones(first: string): string[] {
  let all: string[] = [];
  try { all = Intl.supportedValuesOf("timeZone"); } catch { all = []; }
  return [first, ...["UTC", ...all].filter((zone) => zone !== first)];
}
/** A `datetime-local` value in `zone` for an ISO instant, and back. Spring gaps and fall overlaps are the server's to resolve for weekly slots; a set time is an exact instant. */
export const localValue = (iso: string, zone: string) => toLocalInput(iso, zone);
export const instantFrom = (local: string, zone: string) => fromLocalInput(local, zone);
/** The instant shown in the person's own words in `zone`, for example "Mon, Nov 23, 9:00 AM". */
export function formatWhen(iso: string, zone: string, locale = "en") {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export const formatClock = (iso: string, zone: string, locale = "en") => new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
