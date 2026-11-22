import { describe, expect, it } from "vitest";
import { periodRegions, periodWindows, regionBounds, releaseRows, reportPeriods, reportsMinistryScope, SMALL_GROUP, type ReportRow } from "../../src/lib/crm-reports";
import { can } from "../../src/lib/permissions";

const now = new Date("2026-11-22T12:00:00Z");
const row = (key: string, counts: Record<number, number>, leaf = "n"): ReportRow => ({ key, leaves: { [leaf]: counts } });
const iso = (date: Date) => date.toISOString();

describe("periods and regions", () => {
  it("builds the five UTC periods", () => {
    const windows = periodWindows(now);
    expect(Object.keys(windows)).toEqual([...reportPeriods]);
    expect(iso(windows.last7.start)).toBe("2026-11-16T00:00:00.000Z");
    expect(iso(windows.last30.start)).toBe("2026-10-24T00:00:00.000Z");
    expect(iso(windows.last90.start)).toBe("2026-08-25T00:00:00.000Z");
    expect(iso(windows.thisMonth.start)).toBe("2026-11-01T00:00:00.000Z");
    expect([iso(windows.lastMonth.start), iso(windows.lastMonth.end)]).toEqual(["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
    expect(windows.last7.end).toEqual(now);
  });
  it("crosses a year boundary for last month", () => {
    const january = periodWindows(new Date("2027-01-10T08:00:00Z")).lastMonth;
    expect([iso(january.start), iso(january.end)]).toEqual(["2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  });
  it("covers each period with whole regions", () => {
    expect(regionBounds(now)).toHaveLength(6);
    expect(Object.fromEntries(reportPeriods.map((period) => [period, periodRegions(period, now)]))).toEqual({ last7: [5], last30: [3, 4, 5], last90: [1, 2, 3, 4, 5], thisMonth: [4, 5], lastMonth: [2, 3] });
  });
  it("copes with boundaries that coincide (the first of the month)", () => {
    const first = new Date("2026-11-01T09:00:00Z");
    for (const period of reportPeriods) expect(periodRegions(period, first).every((region) => region >= 1)).toBe(true);
    expect(periodRegions("thisMonth", first).length).toBeGreaterThan(0);
  });
});

describe("small-group suppression", () => {
  it("publishes everything when every region is 0 or at least five", () => {
    const release = releaseRows([1, 2], [row("a", { 1: 5, 2: 0 }), row("b", { 1: 9, 2: 7 })]);
    expect([...release.hidden]).toEqual([]);
    expect(release.totalShown).toBe(true);
  });
  it("withholds a row and its region-level total when any region is 1 to 4", () => {
    const release = releaseRows([1, 2], [row("a", { 1: 3 }), row("b", {})]);
    expect([...release.hidden]).toEqual(["a"]);
    expect(release.totalShown).toBe(false);
  });
  it("hides a row whose period sum is large but one region is small (difference between nested periods)", () => {
    const release = releaseRows([4, 5], [row("a", { 4: 3, 5: 10 }), row("b", { 4: 6, 5: 6 })]);
    expect(release.hidden.has("a")).toBe(true);
  });
  it("hides the smallest visible row too (complementary) so the hidden sum cannot be subtracted from the total", () => {
    const release = releaseRows([1], [row("small", { 1: 2 }), row("mid", { 1: 5 }), row("big", { 1: 40 }), row("none", {})]);
    expect(release.totalShown).toBe(true);
    expect([...release.hidden].sort()).toEqual(["mid", "small"]);
  });
  it("never lets total minus the visible rows reveal a region sum of 1 to 4", () => {
    const rows = [row("a", { 1: 2, 2: 1 }), row("b", { 1: 6, 2: 5 }), row("c", { 1: 7, 2: 9 }), row("d", { 1: 12, 2: 0 })];
    const release = releaseRows([1, 2], rows);
    if (release.totalShown) for (const region of [1, 2]) {
      const hiddenSum = rows.filter((candidate) => release.hidden.has(candidate.key)).reduce((total, candidate) => total + (candidate.leaves.n?.[region] ?? 0), 0);
      expect(hiddenSum === 0 || hiddenSum >= SMALL_GROUP).toBe(true);
    }
  });
  it("checks every leaf (a with-deal and a without-deal count)", () => {
    const rows: ReportRow[] = [{ key: "manual", leaves: { withDeal: { 1: 9 }, noDeal: { 1: 2 } } }, { key: "csv", leaves: { withDeal: { 1: 6 }, noDeal: { 1: 8 } } }];
    expect(releaseRows([1], rows).hidden.has("manual")).toBe(true);
  });
  it("shows zeros", () => {
    const release = releaseRows([0], [row("overdue", {}), row("onTime", {})]);
    expect([...release.hidden]).toEqual([]);
    expect(release.totalShown).toBe(true);
  });
});

describe("report access", () => {
  it("lets owners, admins and members read and keeps viewers out", () => {
    expect(["owner", "admin", "member", "viewer"].map((role) => can(role, "crm:reports"))).toEqual([true, true, true, false]);
    expect(["owner", "admin", "member", "viewer"].map(reportsMinistryScope)).toEqual([true, true, false, false]);
  });
});
