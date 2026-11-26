import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { daysRange, dateKey, parseDate, parseEventsView, shiftDays, viewRange, weekStart, weekTitle, type EventItem } from "../../src/lib/event-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
const { EventsBoard } = await import("../../src/components/events/events-board");
const { WeekView } = await import("../../src/components/calendar/week-view");
const { gridScrollTop, openingHour } = await import("../../src/lib/calendar-days");

// Events week and day views (founder decision, 26 Nov): the shared week grid, with the view and the day in the URL.
const item = (id: string, startsAt: string, endsAt: string, extra: Partial<EventItem> = {}): EventItem => ({
  id, title: `Event ${id}`, description: "", timeZone: "America/New_York", startsAt, endsAt, updatedAt: startsAt, status: "published", version: 1,
  capacity: null, available: null, rsvp: null, rsvpVersion: 0, canClaimSeat: false, reminderMinutes: null, ...extra,
});
const now = new Date(2026, 10, 26, 9).getTime();
const render = (props: Partial<Parameters<typeof EventsBoard>[0]>) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, timeZone: "UTC",
  children: h(EventsBoard, { events: [], view: "week", month: "2026-11", date: "2026-11-26", base: "/e", detail: "/e", now, ...props }) }));

describe("week and day helpers", () => {
  it("parses views and days, falling back for anything else", () => {
    expect(["list", "calendar", "week", "day", "agenda", undefined].map(parseEventsView)).toEqual(["list", "calendar", "week", "day", "list", "list"]);
    expect(dateKey(parseDate("2026-02-28", new Date(now)))).toBe("2026-02-28");
    for (const bad of ["2026-02-30", "2026-13-01", "26-11-01", "", null]) expect(dateKey(parseDate(bad, new Date(now))), String(bad)).toBe("2026-11-26");
  });
  it("starts weeks on Monday like the shared grid and pads API ranges for every time zone", () => {
    expect(dateKey(weekStart(new Date(2026, 10, 26)))).toBe("2026-11-23");
    expect(dateKey(weekStart(new Date(2026, 10, 29)))).toBe("2026-11-23");
    expect(dateKey(weekStart(new Date(2026, 10, 30)))).toBe("2026-11-30");
    expect(dateKey(shiftDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
    expect(daysRange(new Date(2026, 10, 23), 7)).toEqual({ from: "2026-11-21T12:00:00.000Z", to: "2026-12-01T12:00:00.000Z" });
    expect(viewRange("day", new Date(2026, 10, 1), new Date(2026, 10, 26))).toEqual(daysRange(new Date(2026, 10, 26), 1));
    expect(viewRange("week", new Date(2026, 10, 1), new Date(2026, 10, 26))).toEqual(daysRange(new Date(2026, 10, 23), 7));
    expect(viewRange("list", new Date(2026, 10, 1), new Date(2026, 10, 26))).toBeNull();
    const { from, to } = daysRange(new Date(2026, 10, 23), 7);
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBeLessThanOrEqual(100);
  });
});

describe("Events board week and day", () => {
  it("offers list, month, week and day as URL links with the current one marked", () => {
    const html = render({ view: "week" });
    for (const [label, href] of [["List", "/e"], ["Month", "/e?view=calendar&amp;month=2026-11"], ["Week", "/e?view=week&amp;date=2026-11-26"], ["Day", "/e?view=day&amp;date=2026-11-26"]])
      expect(html, label).toContain(`href="${href}"`);
    expect(html).toMatch(/aria-current="page"[^>]*>Week</);
  });
  it("renders the shared week grid with previous, next and today links, and events in their own wall-clock time", () => {
    const html = render({ view: "week", events: [item("a", "2026-11-25T15:00:00.000Z", "2026-11-25T16:00:00.000Z")] });
    expect(html).toContain('data-slot="week-view"');
    expect(html).toContain('href="/e?view=week&amp;date=2026-11-16"');
    expect(html).toContain('href="/e?view=week&amp;date=2026-11-30"');
    expect(html).toContain('aria-label="Previous week"');
    expect(html).toContain("Event time");
    expect(html).toContain("Event a");
    expect(html).toContain("10:00 AM"); // 15:00 UTC is 10:00 in New York, whatever the viewer's zone
    expect(html.match(/data-today|Wed 25/g)?.length).toBeGreaterThan(0);
  });
  it("renders one day column in day view and an empty note when nothing is on", () => {
    const html = render({ view: "day", date: "2026-11-27" });
    expect(html).toContain('data-slot="week-view"');
    expect(html).toContain("Friday, November 27, 2026");
    expect(html).toContain('href="/e?view=day&amp;date=2026-11-26"');
    expect(html).toContain('href="/e?view=day&amp;date=2026-11-28"');
    expect(html).toContain("No events on this day.");
    expect(render({ view: "week" })).toContain("No events this week.");
  });
  it("collapses events at the same time into one block with a +N button", () => {
    const html = render({ view: "day", date: "2026-11-25", events: [item("a", "2026-11-25T15:00:00.000Z", "2026-11-25T16:00:00.000Z"), item("b", "2026-11-25T15:30:00.000Z", "2026-11-25T16:30:00.000Z")] });
    expect(html).toContain('data-testid="overlap-more"');
    expect(html).toContain('aria-label="1 more event at this time"');
  });
});

// Founder screenshots, 26 Nov: a hydration mismatch on the week title, and the first hour label under the sticky header after the grid opened at 7 AM.
describe("week grid hydration and opening hour", () => {
  it("renders the week title the same on the server and in the first client render, then the browser's own range format", () => {
    const first = new Date(2026, 10, 23), last = new Date(2026, 10, 29);
    expect(weekTitle(first, last, "en", false)).toBe("Nov 23 – Nov 29, 2026");
    expect(weekTitle(new Date(2026, 11, 28), new Date(2027, 0, 3), "en", false)).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(weekTitle(first, last, "en", true)).toBe(new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).formatRange(first, last));
    expect(render({ view: "week" })).toContain("Nov 23 – Nov 29, 2026");
  });
  it("leaves today and the viewer's GMT offset out of the server render, so it never depends on the server's zone", () => {
    const html = renderToStaticMarkup(h(WeekView, { currentDate: new Date(), events: [], label: "Week", onEventSelect: () => undefined, renderChip: () => null,
      overlap: { moreLabel: () => "", moreText: () => "", title: "", renderRow: () => null } }));
    expect(html).not.toMatch(/ data-today(=|>| )/);
    expect(html).not.toMatch(/GMT/);
    expect(html).toContain('data-hour-row="7"');
  });
  it("opens an hour before the earliest timed event in range, never later than 7 AM, ignoring all-day, multi-day and out-of-range entries", () => {
    const from = new Date(2026, 10, 23), to = new Date(2026, 10, 30);
    const at = (d: number, h: number, extra: { allDay?: boolean; endDay?: number } = {}) => ({ start: new Date(2026, 10, d, h), end: new Date(2026, 10, extra.endDay ?? d, h + 1), allDay: extra.allDay });
    expect(openingHour([], from, to)).toBe(7);
    expect(openingHour([at(24, 10)], from, to)).toBe(7);
    expect(openingHour([at(24, 10), at(25, 6)], from, to)).toBe(5);
    expect(openingHour([at(25, 0)], from, to)).toBe(0);
    expect(openingHour([at(25, 3, { allDay: true }), at(25, 4, { endDay: 26 }), at(30, 2), at(22, 2)], from, to)).toBe(7);
  });
  it("scrolls so the hour label (centred on its line) sits wholly below the sticky header", () => {
    // Row 7 starts 7 * 64 px under a 37 px header: the line lands 16 px below the header, so the 24 px label (12 px above the line) clears it by 4 px.
    expect(gridScrollTop(37 + 7 * 64, 37)).toBe(7 * 64 - 16);
    expect(gridScrollTop(37, 37)).toBe(0);
    expect(gridScrollTop(10.4, 0, 0)).toBe(10);
  });
});
