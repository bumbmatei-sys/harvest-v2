import { describe, expect, it } from "vitest";
import { eventPhase, formatTimeRange, fromLocalInput, groupByDay, mayAskForJoinLink, monthRange, parseMonth, toLocalInput, wallClock } from "../../src/lib/event-view";
import { emptyFields, fieldProblems, reminderPresets, saveBody } from "../../src/lib/event-form";
import { getAllEventsForDay, getEventsForDay, isMultiDayEvent, sortEvents } from "../../src/lib/calendar-days";

const event = (startsAt: string, endsAt: string, extra = {}) => ({ startsAt, endsAt, timeZone: "America/New_York", status: "published" as const, ...extra });

describe("event time zones", () => {
  it("reads and writes wall clocks in the event's own zone, including across daylight saving", () => {
    expect(toLocalInput("2026-11-21T23:00:00.000Z", "America/New_York")).toBe("2026-11-21T18:00");
    expect(fromLocalInput("2026-11-21T18:00", "America/New_York")).toBe("2026-11-21T23:00:00.000Z");
    expect(fromLocalInput("2026-07-04T18:00", "America/New_York")).toBe("2026-07-04T22:00:00.000Z");
    expect(fromLocalInput("2026-11-21T18:00", "Asia/Kolkata")).toBe("2026-11-21T12:30:00.000Z");
    expect(fromLocalInput("not a date", "UTC")).toBeNull();
    for (const zone of ["UTC", "Europe/Paris", "Pacific/Auckland"]) expect(fromLocalInput(toLocalInput("2026-03-29T01:30:00.000Z", zone), zone)).toBe("2026-03-29T01:30:00.000Z");
  });
  it("builds calendar dates that do not depend on the viewer's zone", () => {
    const day = wallClock("2026-11-22T03:30:00.000Z", "America/New_York");
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 10, 21, 22]);
  });
  it("formats the time range in the event's zone with the zone abbreviation", () => {
    expect(formatTimeRange(event("2026-11-21T23:00:00.000Z", "2026-11-22T00:30:00.000Z"))).toBe("6:00 PM – 7:30 PM EST");
  });
  it("groups by the event's own day, in order", () => {
    const groups = groupByDay([event("2026-11-22T03:30:00.000Z", "2026-11-22T04:30:00.000Z"), event("2026-11-21T15:00:00.000Z", "2026-11-21T16:00:00.000Z"), event("2026-11-21T20:00:00.000Z", "2026-11-21T21:00:00.000Z")]);
    expect(groups.map((g) => [g.key, g.events.length])).toEqual([["2026-11-21", 3]]);
  });
});

describe("event phases and the join link", () => {
  const now = Date.parse("2026-11-21T12:00:00.000Z");
  it("names cancelled, ended, live and upcoming", () => {
    expect(eventPhase(event("2026-11-21T13:00:00.000Z", "2026-11-21T14:00:00.000Z"), now)).toBe("upcoming");
    expect(eventPhase(event("2026-11-21T11:00:00.000Z", "2026-11-21T14:00:00.000Z"), now)).toBe("live");
    expect(eventPhase(event("2026-11-21T09:00:00.000Z", "2026-11-21T12:00:00.000Z"), now)).toBe("ended");
    expect(eventPhase(event("2026-11-21T13:00:00.000Z", "2026-11-21T14:00:00.000Z", { status: "cancelled" }), now)).toBe("cancelled");
    expect(eventPhase(event("2026-11-21T13:00:00.000Z", "2026-11-21T14:00:00.000Z", { status: "draft" }), now)).toBe("draft");
  });
  it("only asks the server for a link from the widest possible window until the end, for a published event", () => {
    expect(mayAskForJoinLink(event("2026-11-23T12:00:00.000Z", "2026-11-23T13:00:00.000Z"), now)).toBe(false);
    expect(mayAskForJoinLink(event("2026-11-22T11:00:00.000Z", "2026-11-22T13:00:00.000Z"), now)).toBe(true);
    expect(mayAskForJoinLink(event("2026-11-21T09:00:00.000Z", "2026-11-21T12:00:00.000Z"), now)).toBe(false);
    expect(mayAskForJoinLink(event("2026-11-21T11:00:00.000Z", "2026-11-21T14:00:00.000Z", { status: "cancelled" }), now)).toBe(false);
  });
});

describe("month ranges", () => {
  it("falls back to the current month for a bad value and stays inside the 100 day limit", () => {
    expect(parseMonth("2026-13", new Date(2026, 10, 5)).getMonth()).toBe(10);
    expect(parseMonth("2027-02", new Date(2026, 10, 5)).getFullYear()).toBe(2027);
    const { from, to } = monthRange(new Date(2026, 11, 1));
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBeLessThan(100);
  });
});

describe("event form rules", () => {
  const base = { ...emptyFields("UTC", new Date("2026-11-21T10:00:00Z")), title: "Gathering" };
  it("accepts a valid draft and sends instants, a number capacity and a trimmed link", () => {
    const body = saveBody({ ...base, capacity: " 12 ", reminder: String(reminderPresets[1]), joinUrl: " https://meet.example.test/room " });
    expect(body).toMatchObject({ title: "Gathering", capacity: 12, reminderMinutes: 60, joinUrl: "https://meet.example.test/room", timeZone: "UTC" });
    expect(body?.startsAt).toBe("2026-11-21T11:00:00.000Z");
    expect(saveBody(base)).toMatchObject({ capacity: null, reminderMinutes: null, joinUrl: null });
  });
  it("names each problem", () => {
    expect(fieldProblems({ ...base, title: "  " })).toEqual(["title"]);
    expect(fieldProblems({ ...base, endsAt: base.startsAt })).toEqual(["order"]);
    expect(fieldProblems({ ...base, startsAt: "" })).toEqual(["start"]);
    expect(fieldProblems({ ...base, capacity: "0" })).toEqual(["capacity"]);
    expect(fieldProblems({ ...base, joinUrl: "http://meet.example.test" })).toEqual(["join"]);
    expect(fieldProblems({ ...base, joinUrl: "https://user:pw@meet.example.test" })).toEqual(["join"]);
    expect(saveBody({ ...base, title: "" })).toBeNull();
  });
});

describe("copied calendar day helpers", () => {
  const e = (id: string, start: Date, end: Date) => ({ id, title: id, start, end, status: "published" as const, ended: false });
  const events = [e("b", new Date(2026, 10, 21, 15), new Date(2026, 10, 21, 16)), e("a", new Date(2026, 10, 21, 9), new Date(2026, 10, 21, 10)), e("span", new Date(2026, 10, 20, 9), new Date(2026, 10, 22, 10))];
  it("buckets by start day, sorts multi-day first and finds events spanning a day", () => {
    expect(getEventsForDay(events, new Date(2026, 10, 21)).map((x) => x.id)).toEqual(["a", "b"]);
    expect(isMultiDayEvent(events[2])).toBe(true);
    expect(sortEvents(events).map((x) => x.id)).toEqual(["span", "a", "b"]);
    expect(getAllEventsForDay(events, new Date(2026, 10, 21)).map((x) => x.id).sort()).toEqual(["a", "b", "span"]);
  });
});
