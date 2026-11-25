/**
 * CRM reports: periods, atomic regions and small-group suppression. Pure (imports only the time zone helpers), shared by the server and the screen.
 *
 * Periods (in the ministry's time zone, UTC by default): last 7, 30 and 90 days (today included) and this and last month. They overlap, so
 * every period is a union of ATOMIC REGIONS: the intervals between all period boundaries. A published figure is a sum of region counts.
 * Suppression strategy (docs/acceptance/crm-reports.md):
 *  1. A row (one cell or one breakdown line) is withheld for a period if any region inside the period has a count of 1 to 4 in any of its leaves.
 *     Because every published figure is then a sum of regions that are each 0 or at least 5, a difference between two published periods
 *     (nested or overlapping) is also a sum of such regions and never a group of 1 to 4.
 *  2. The total is published only if every region total is 0 or at least 5.
 *  3. Complementary suppression: when rows are withheld and the total is published, the hidden rows' sum is derivable (total minus the rest).
 *     Smallest non-zero visible rows are therefore hidden too until that derivable sum is itself 0 or at least 5 in every region.
 * Withheld figures are all shown the same way ("fewer than 5"), so a reader cannot tell which were protective.
 */
import { DEFAULT_TIME_ZONE, zonedDate, zonedStartOfDay } from "./time-zone";
export const SMALL_GROUP = 5;
export const reportPeriods = ["last7", "last30", "last90", "thisMonth", "lastMonth"] as const;
export type ReportPeriod = typeof reportPeriods[number];
export const reportSources = ["manual", "csv_import", "connect", "form", "unknown"] as const;
export type ReportSource = typeof reportSources[number];
/** Roles that see ministry totals; every other reading role sees only its own work. */
export const reportsMinistryScope = (role: string) => role === "owner" || role === "admin";

export type PeriodWindow = { start: Date; end: Date };
/** Periods are calendar days in the ministry's time zone (UTC by default); a day that is 23 or 25 hours long still counts as one day. */
export function periodWindows(now: Date, timeZone: string = DEFAULT_TIME_ZONE): Record<ReportPeriod, PeriodWindow> {
  const { year, month, day } = zonedDate(now, timeZone), startOfDay = (offset: number) => zonedStartOfDay(year, month, day - offset, timeZone);
  const thisMonth = zonedStartOfDay(year, month, 1, timeZone), lastMonth = zonedStartOfDay(year, month - 1, 1, timeZone);
  const last = (days: number) => ({ start: startOfDay(days - 1), end: now });
  return { last7: last(7), last30: last(30), last90: last(90), thisMonth: { start: thisMonth, end: now }, lastMonth: { start: lastMonth, end: thisMonth } };
}
/** Sorted unique boundaries of every period, ending at `now`. Region i (1-based) is [bounds[i-1], bounds[i]). */
export function regionBounds(now: Date, timeZone: string = DEFAULT_TIME_ZONE): Date[] {
  const all = Object.values(periodWindows(now, timeZone)).flatMap((window) => [window.start.getTime(), window.end.getTime()]);
  return [...new Set(all)].sort((a, b) => a - b).map((time) => new Date(time));
}
/** The 1-based region numbers inside a period (the database numbers a timestamp by how many boundaries are at or before it). */
export function periodRegions(period: ReportPeriod, now: Date, timeZone: string = DEFAULT_TIME_ZONE): number[] {
  const bounds = regionBounds(now, timeZone), { start, end } = periodWindows(now, timeZone)[period], regions: number[] = [];
  for (let index = 1; index < bounds.length; index++) if (bounds[index - 1]! >= start && bounds[index]! <= end) regions.push(index);
  return regions;
}

/** One breakdown line. `leaves` maps a leaf name to its count per region (missing region = 0). */
export type ReportRow = { key: string; leaves: Record<string, Record<number, number>> };
export type Release = { hidden: ReadonlySet<string>; totalShown: boolean };
const safeCount = (count: number) => count === 0 || count >= SMALL_GROUP;
const at = (row: ReportRow, leaf: string, region: number) => row.leaves[leaf]?.[region] ?? 0;
export function releaseRows(regions: readonly number[], rows: readonly ReportRow[]): Release {
  const leaves = [...new Set(rows.flatMap((row) => Object.keys(row.leaves)))];
  const sum = (group: readonly ReportRow[], leaf: string, region: number) => group.reduce((total, row) => total + at(row, leaf, region), 0);
  const groupSafe = (group: readonly ReportRow[]) => leaves.every((leaf) => regions.every((region) => safeCount(sum(group, leaf, region))));
  const hidden = new Set(rows.filter((row) => !groupSafe([row])).map((row) => row.key));
  if (!groupSafe(rows)) return { hidden, totalShown: false };
  const weight = (row: ReportRow) => leaves.reduce((total, leaf) => total + regions.reduce((inner, region) => inner + at(row, leaf, region), 0), 0);
  const candidates = rows.filter((row) => !hidden.has(row.key) && weight(row) > 0).sort((a, b) => weight(a) - weight(b) || a.key.localeCompare(b.key));
  while (hidden.size && !groupSafe(rows.filter((row) => hidden.has(row.key)))) {
    const next = candidates.shift();
    if (!next) break;
    hidden.add(next.key);
  }
  return { hidden, totalShown: true };
}
/** Total of a leaf over the regions of a period. */
export const leafTotal = (regions: readonly number[], row: ReportRow, leaf: string) => regions.reduce((total, region) => total + at(row, leaf, region), 0);
export const percent = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
