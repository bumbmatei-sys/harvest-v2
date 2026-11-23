import { describe, expect, it } from "vitest";
import { addPlainDays, zonedInstant, zonedParts, agendaDays, calendarEvent, isSocialId, overlayStatuses, plannerHref, rangeFor, safeLink, shiftDate, socialEvent, type CalendarItem } from "../../src/lib/office/calendar";
import type { PlannerItem } from "../../src/lib/social/api";

const item = (extra: Partial<CalendarItem>): CalendarItem => ({ ref: "e", calendarRef: "c", title: "Meeting", start: "2026-11-23T10:00:00.000Z", end: "2026-11-23T11:00:00.000Z", attendees: [], meetingLink: null, ...extra });

describe("office calendar library", () => {
  it("reads each view's window, Monday first, within the server's 93 days", () => {
    const date = new Date(2026, 10, 25);
    for (const view of ["month", "week", "day", "agenda"] as const) {
      const { from, to } = rangeFor(view, date);
      expect(to.getTime() - from.getTime()).toBeLessThanOrEqual(93 * 86_400_000);
      expect(to > from).toBe(true);
    }
    expect(rangeFor("week", date).from.getDay()).toBe(1);
    expect(rangeFor("month", date).from.getDay()).toBe(1);
    expect(Math.round((rangeFor("agenda", date).to.getTime() - rangeFor("agenda", date).from.getTime()) / 86_400_000)).toBe(agendaDays);
  });
  it("steps by the view's own unit", () => {
    const date = new Date(2026, 10, 25);
    expect(shiftDate("day", date, 1).getDate()).toBe(26);
    expect(shiftDate("week", date, -1).getDate()).toBe(18);
    expect(shiftDate("month", date, 1).getMonth()).toBe(11);
    expect(shiftDate("agenda", date, 1).getDate()).toBe(25 + agendaDays - 30);
  });
  it("treats a plain date as a local all-day, with an exclusive end", () => {
    const event = calendarEvent(item({ start: "2026-11-24", end: "2026-11-26" }), 0);
    expect(event.allDay).toBe(true);
    expect(event.start.getDate()).toBe(24);
    expect(event.end.getDate()).toBe(25);
    const single = calendarEvent(item({ start: "2026-11-24", end: "2026-11-24" }), 0);
    expect(single.start.getDate()).toBe(24);
    expect(single.end.getDate()).toBe(24);
    expect(calendarEvent(item({}), Date.parse("2027-01-01")).ended).toBe(true);
  });
  it("keys events by calendar and reference, and social posts apart from them", () => {
    expect(calendarEvent(item({}), 0).id).toBe("cal:c:e");
    const post = { id: "p", at: "2026-11-23T15:00:00.000Z", summary: `  ${"x".repeat(80)}  ` } as PlannerItem;
    expect(isSocialId(socialEvent(post, 0).id)).toBe(true);
    expect(socialEvent(post, 0).title).toHaveLength(60);
  });
  it("overlays only posts still to go out", () => {
    expect([...overlayStatuses].sort()).toEqual(["publishing", "queued", "scheduled"]);
  });
  it("links to the planner week of a post and accepts only web join links", () => {
    expect(plannerHref("t", { at: "2026-11-25T12:00:00.000Z" })).toMatch(/^\/workspaces\/t\/social\/planner\?view=calendar&mode=week&week=2026-11-2[0-9]$/);
    expect(safeLink("https://meet.example.test/x")).toBe("https://meet.example.test/x");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("http://meet.example.test/x")).toBeNull();
    expect(safeLink(null)).toBeNull();
  });
});

describe("zoned event times", () => {
  it("converts wall-clock times in the calendar's zone, across daylight saving", () => {
    expect(zonedInstant("2026-11-25", "09:00", "America/New_York")).toBe("2026-11-25T14:00:00.000Z");
    expect(zonedInstant("2026-07-01", "09:00", "America/New_York")).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedInstant("2026-11-25", "09:00", "Europe/Bucharest")).toBe("2026-11-25T07:00:00.000Z");
    expect(zonedInstant("2026-11-25", "24:00", "UTC")).toBe("2026-11-26T00:00:00.000Z");
  });
  it("reads an instant back as the same wall clock and adds plain days", () => {
    expect(zonedParts("2026-11-25T14:00:00.000Z", "America/New_York")).toEqual({ date: "2026-11-25", time: "09:00" });
    expect(zonedParts("2026-11-25T23:30:00.000Z", "Pacific/Auckland")).toEqual({ date: "2026-11-26", time: "12:30" });
    expect(addPlainDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addPlainDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
