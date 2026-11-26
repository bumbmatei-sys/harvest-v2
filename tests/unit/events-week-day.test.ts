import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { daysRange, dateKey, parseDate, parseEventsView, shiftDays, viewRange, weekStart, type EventItem } from "../../src/lib/event-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
const { EventsBoard } = await import("../../src/components/events/events-board");

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
