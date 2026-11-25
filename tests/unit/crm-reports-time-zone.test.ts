import { describe, expect, it } from "vitest";
import { periodRegions, periodWindows, regionBounds, reportPeriods } from "../../src/lib/crm-reports";
import { reportCsvFileName, reportTableCsv, type ReportCsvLabels } from "../../src/lib/crm-reports-csv";
import { browserTimeZone, isValidTimeZone, timeZoneChoices, timeZoneOrDefault, zonedIsoDate, zonedStartOfDay } from "../../src/lib/time-zone";
import { can } from "../../src/lib/permissions";
import type { CrmReport } from "../../src/server/crm-reports";

const iso = (date: Date) => date.toISOString();

describe("time zone validation", () => {
  it("accepts UTC and region/city names and refuses everything else", () => {
    for (const ok of ["UTC", "Europe/Berlin", "America/New_York", "America/Argentina/Buenos_Aires", "Asia/Kolkata"]) expect(isValidTimeZone(ok)).toBe(true);
    for (const bad of ["", "EST", "GMT+2", "+02:00", "Mars/Olympus", "Europe/", "../etc/passwd", "Europe/Berlin; drop", 42, null, "x".repeat(65)]) expect(isValidTimeZone(bad)).toBe(false);
    expect(timeZoneOrDefault("Mars/Olympus")).toBe("UTC");
    expect(timeZoneOrDefault("Europe/Berlin")).toBe("Europe/Berlin");
  });
  it("offers UTC first and always includes the current zone", () => {
    const choices = timeZoneChoices("Europe/Berlin");
    expect(choices[0]).toBe("UTC");
    expect(choices).toContain("Europe/Berlin");
    expect(new Set(choices).size).toBe(choices.length);
    expect(browserTimeZone === undefined || typeof browserTimeZone()).toBeTruthy();
  });
});

describe("start of day across daylight-saving changes", () => {
  it("handles a 23-hour and a 25-hour day (Berlin, 2026)", () => {
    expect(iso(zonedStartOfDay(2026, 3, 29, "Europe/Berlin"))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(zonedStartOfDay(2026, 3, 30, "Europe/Berlin"))).toBe("2026-03-29T22:00:00.000Z");
    expect(iso(zonedStartOfDay(2026, 10, 25, "Europe/Berlin"))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(zonedStartOfDay(2026, 10, 26, "Europe/Berlin"))).toBe("2026-10-25T23:00:00.000Z");
  });
  it("starts a day that has no midnight at the change itself (Sao Paulo, 4 Nov 2018)", () => {
    expect(iso(zonedStartOfDay(2018, 11, 4, "America/Sao_Paulo"))).toBe("2018-11-04T03:00:00.000Z");
  });
  it("uses calendar arithmetic for overflowing days and months", () => {
    expect(iso(zonedStartOfDay(2026, 1, 0, "UTC"))).toBe("2025-12-31T00:00:00.000Z");
    expect(iso(zonedStartOfDay(2026, 0, 1, "UTC"))).toBe("2025-12-01T00:00:00.000Z");
  });
  it("reads the local date of an instant", () => {
    expect(zonedIsoDate(new Date("2026-11-24T02:00:00Z"), "America/Los_Angeles")).toBe("2026-11-23");
    expect(zonedIsoDate(new Date("2026-11-24T23:30:00Z"), "Pacific/Auckland")).toBe("2026-11-25");
  });
});

describe("report periods in a time zone", () => {
  it("keeps UTC identical to the old behaviour", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    expect(iso(periodWindows(now, "UTC").last30.start)).toBe(iso(periodWindows(now).last30.start));
    expect(iso(periodWindows(now).last7.start)).toBe("2026-11-16T00:00:00.000Z");
  });
  it("moves every boundary to local midnight (Los Angeles, standard time)", () => {
    const windows = periodWindows(new Date("2026-11-24T02:00:00Z"), "America/Los_Angeles"); // still 23 Nov locally
    expect(iso(windows.last7.start)).toBe("2026-11-17T08:00:00.000Z");
    expect(iso(windows.thisMonth.start)).toBe("2026-11-01T07:00:00.000Z"); // 1 Nov is still daylight time
    expect([iso(windows.lastMonth.start), iso(windows.lastMonth.end)]).toEqual(["2026-10-01T07:00:00.000Z", "2026-11-01T07:00:00.000Z"]);
  });
  it("counts a day containing a clock change as one day: seven days back across the spring change (Berlin)", () => {
    const windows = periodWindows(new Date("2026-04-02T10:00:00Z"), "Europe/Berlin");
    expect(iso(windows.last7.start)).toBe("2026-03-26T23:00:00.000Z"); // 27 Mar 00:00 CET, two days before the change on 29 Mar
    expect(iso(windows.last30.start)).toBe("2026-03-03T23:00:00.000Z");
    expect(iso(windows.thisMonth.start)).toBe("2026-03-31T22:00:00.000Z"); // 1 Apr 00:00 CEST
    expect([iso(windows.lastMonth.start), iso(windows.lastMonth.end)]).toEqual(["2026-02-28T23:00:00.000Z", "2026-03-31T22:00:00.000Z"]); // March is 743 hours long
  });
  it("crosses the autumn change and a year boundary", () => {
    expect(iso(periodWindows(new Date("2026-10-27T10:00:00Z"), "Europe/Berlin").last7.start)).toBe("2026-10-20T22:00:00.000Z");
    const january = periodWindows(new Date("2027-01-10T08:00:00Z"), "Asia/Tokyo").lastMonth;
    expect([iso(january.start), iso(january.end)]).toEqual(["2026-11-30T15:00:00.000Z", "2026-12-31T15:00:00.000Z"]);
  });
  it("uses the local date, so a late-evening UTC instant is already tomorrow in Auckland", () => {
    const now = new Date("2026-11-30T23:30:00Z"); // 1 Dec 12:30 in Auckland
    expect(iso(periodWindows(now, "Pacific/Auckland").thisMonth.start)).toBe("2026-11-30T11:00:00.000Z");
    expect(iso(periodWindows(now, "UTC").thisMonth.start)).toBe("2026-11-01T00:00:00.000Z");
  });
  it("still covers each period with whole regions in any zone", () => {
    for (const zone of ["UTC", "Europe/Berlin", "America/Sao_Paulo", "Pacific/Kiritimati", "Asia/Kolkata"]) for (const instant of ["2026-03-29T01:30:00Z", "2026-11-01T05:00:00Z", "2026-11-22T12:00:00Z"]) {
      const now = new Date(instant), bounds = regionBounds(now, zone);
      expect(bounds.every((bound, index) => index === 0 || bound > bounds[index - 1]!)).toBe(true);
      for (const period of reportPeriods) expect(periodRegions(period, now, zone).length).toBeGreaterThan(0);
    }
  });
});

const labels: ReportCsvLabels = {
  hidden: "Fewer than 5", periodStart: "Period start", periodEnd: "Period end", timeZone: "Time zone",
  deals: { outcome: "Outcome", count: "Deals", won: "Won", open: "Open", lost: "Lost" }, tasks: { status: "Status", count: "Tasks", overdue: "Overdue", onTime: "On time" },
  sources: { source: "Source", added: "Added", withDeal: "With a deal", manual: "Manual", csv_import: "CSV", connect: "Connect", form: "Forms", ad_lead: "Ad leads", unknown: "Unknown" },
  stages: { pipeline: "Pipeline", from: "From", to: "To", moved: "Moved", medianDays: "Median days" },
};
const report: CrmReport = {
  period: "last30", scope: "ministry", timeZone: "America/Los_Angeles", generatedAt: "2026-11-24T02:00:00.000Z", minimumGroup: 5,
  window: { start: "2026-10-25T07:00:00.000Z", end: "2026-11-24T02:00:00.000Z" },
  deals: { created: 20, won: 12, open: null, lost: 0, conversionPercent: 60 }, tasks: { completed: 7, open: 9, overdue: null, onTime: 9 },
  contacts: { added: 30, withDeal: 10, sources: [{ source: "manual", added: 20, withDeal: null }, { source: "form", added: null, withDeal: null }, { source: "csv_import", added: 0, withDeal: 0 },
    { source: "connect", added: 10, withDeal: 10 }, { source: "unknown", added: 0, withDeal: 0 }] },
  stages: { trackedFrom: "2026-10-01T00:00:00.000Z", pairs: [{ pipelineId: "p", pipeline: "=HYPERLINK(\"x\")", from: "Lead, new", to: "Won \"big\"", moved: 8, medianDays: 3.5 }, { pipelineId: "p", pipeline: "Sales", from: "A", to: "B", moved: null, medianDays: null },
    { pipelineId: "p", pipeline: "Sales", from: "B", to: "C", moved: 0, medianDays: null }] },
};
describe("report CSV", () => {
  it("writes the figures as the screen shows them, withheld ones as the same words and zero as zero, with the ministry-local period", () => {
    expect(reportTableCsv("deals", report, labels)).toBe("﻿Period start,Period end,Time zone,Outcome,Deals\r\n2026-10-25,2026-11-23,America/Los_Angeles,Won,12\r\n2026-10-25,2026-11-23,America/Los_Angeles,Open,Fewer than 5\r\n2026-10-25,2026-11-23,America/Los_Angeles,Lost,0\r\n");
    expect(reportTableCsv("tasks", report, labels)).toContain("Overdue,Fewer than 5\r\n");
    const sources = reportTableCsv("sources", report, labels).split("\r\n");
    expect(sources).toContain("2026-10-25,2026-11-23,America/Los_Angeles,Manual,20,Fewer than 5");
    expect(sources).toContain("2026-10-25,2026-11-23,America/Los_Angeles,CSV,0,0");
  });
  it("escapes commas, quotes and formulas and withholds the median with its count", () => {
    const lines = reportTableCsv("stages", report, labels).split("\r\n");
    expect(lines[1]).toBe("2026-10-25,2026-11-23,America/Los_Angeles,\"'=HYPERLINK(\"\"x\"\")\",\"Lead, new\",\"Won \"\"big\"\"\",8,3.5");
    expect(lines[2]).toBe("2026-10-25,2026-11-23,America/Los_Angeles,Sales,A,B,Fewer than 5,Fewer than 5");
    expect(lines[3]).toBe("2026-10-25,2026-11-23,America/Los_Angeles,Sales,B,C,0,");
  });
  it("shows the last day of a closed month, not the first of the next", () => {
    const month: CrmReport = { ...report, period: "lastMonth", window: { start: "2026-10-01T07:00:00.000Z", end: "2026-11-01T07:00:00.000Z" } };
    expect(reportTableCsv("deals", month, labels).split("\r\n")[1]).toContain("2026-10-01,2026-10-31,");
  });
  it("names the file after the ministry-local date and carries no personal data", () => {
    expect(reportCsvFileName("stages", report)).toBe("crm-report-stages-last30-2026-11-23.csv");
    expect(JSON.stringify(Object.keys(report))).not.toMatch(/email|name|phone/i);
  });
  it("limits the export to owners and admins", () => {
    expect(["owner", "admin", "member", "viewer"].map((role) => can(role, "crm:reports_export"))).toEqual([true, true, false, false]);
  });
});

import { groupedTimeZones, localTimeLabel, utcOffsetLabel } from "../../src/lib/time-zone-label";
describe("time zone picker labels", () => {
  it("shows the UTC offset and local time of a zone at an instant", () => {
    const at = new Date("2026-11-24T00:00:00Z");
    expect(utcOffsetLabel("UTC", at)).toBe("UTC");
    expect(utcOffsetLabel("Pacific/Auckland", at)).toBe("UTC+13");
    expect(utcOffsetLabel("America/New_York", at)).toBe("UTC-5");
    expect(utcOffsetLabel("Asia/Kolkata", at)).toBe("UTC+5:30");
    expect(localTimeLabel("Pacific/Auckland", at, "en-US")).toBe("1:00 PM");
  });
  it("groups zones by region with UTC first and the current zone included", () => {
    const groups = groupedTimeZones("Europe/Berlin");
    expect(groups[0]).toEqual({ region: "UTC", zones: ["UTC"] });
    expect(groups.find((group) => group.region === "Europe")?.zones).toContain("Europe/Berlin");
  });
});
