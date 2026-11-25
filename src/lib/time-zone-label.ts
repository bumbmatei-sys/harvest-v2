import { timeZoneChoices } from "./time-zone";

/** "UTC+13", "UTC-5", "UTC+5:30" for a zone at an instant (Intl short offset, normalised). */
export function utcOffsetLabel(timeZone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((item) => item.type === "timeZoneName")?.value ?? "GMT";
    const label = part.replace("GMT", "UTC");
    return /^UTC[+-]0(:00)?$/.test(label) ? "UTC" : label;
  } catch { return "UTC"; }
}
/** The local clock time in the zone, in the viewer's locale. */
export function localTimeLabel(timeZone: string, at: Date, locale?: string): string {
  try { return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(at); } catch { return ""; }
}
export type ZoneGroup = { region: string; zones: string[] };
/** Zones grouped by region (the part before the first slash); UTC stands alone first. */
export function groupedTimeZones(current?: string): ZoneGroup[] {
  const groups = new Map<string, string[]>();
  for (const zone of timeZoneChoices(current)) {
    const region = zone.includes("/") ? zone.slice(0, zone.indexOf("/")) : zone;
    (groups.get(region) ?? groups.set(region, []).get(region)!).push(zone);
  }
  return [...groups].map(([region, zones]) => ({ region, zones }));
}
