import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eventCalendarFile, type CalendarEvent } from "../../src/lib/event-calendar";
import { eventSaveInput, eventsEnabled, eventsRoute } from "../../src/server/events";

const event: CalendarEvent = { id: "event-1", title: "Community, test; \\",
  description: `${"🎵".repeat(30)}\r\nATTENDEE:injection`, startsAt: "2026-11-01T01:30:00-04:00",
  endsAt: "2026-11-01T01:45:00-05:00", updatedAt: "2026-10-31T05:00:00.000Z", status: "published", version: 2 };
afterEach(() => vi.unstubAllEnvs());

it("validates IANA timezones, HTTPS and intervals across a DST change", () => {
  const input = { startsAt: event.startsAt, endsAt: event.endsAt, title: event.title, version: 0,
    timeZone: "America/New_York", joinUrl: "https://meeting.example.test/path" };
  expect(eventSaveInput.safeParse(input).success).toBe(true);
  expect(eventSaveInput.safeParse({ ...input, timeZone: "made/up" }).success).toBe(false);
  expect(eventSaveInput.safeParse({ ...input, endsAt: input.startsAt }).success).toBe(false);
  expect(eventSaveInput.safeParse({ ...input, joinUrl: "http://meeting.example.test" }).success).toBe(false);
  expect(eventSaveInput.safeParse({ ...input, joinUrl: "https://login@meeting.example.test" }).success).toBe(false);
});

it("folds UTF-8 calendar lines and keeps a stable UID with versioned cancellation", () => {
  const ics = eventCalendarFile(event, "tenant-1");
  expect(ics.split("\r\n").every(line => Buffer.byteLength(line) <= 75)).toBe(true);
  expect(ics).toContain("UID:event-1.tenant-1@events.harvest");
  expect(ics).toContain("DTSTART:20261101T053000Z");
  expect(ics).toContain("DTEND:20261101T064500Z");
  expect(ics).toContain("SUMMARY:Community\\, test\\; \\\\");
  expect(ics).not.toContain("\r\nATTENDEE:");
  expect(eventCalendarFile({ ...event, version: 3, status: "cancelled" }, "tenant-1")).toContain("SEQUENCE:3\r\nSTATUS:CANCELLED");
});

it("uses the non-production gate before parsing route parameters or authenticating", async () => {
  expect(eventsEnabled({ HARVEST_COMMUNITIES: "enabled", NODE_ENV: "test" })).toBe(true);
  expect(eventsEnabled({ HARVEST_COMMUNITIES: "enabled", NODE_ENV: "production" })).toBe(false);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  const action = vi.fn();
  const response = await eventsRoute(action, { write: true })(new Request("https://test.example.test"), { params: Promise.resolve({}) });
  expect(response.status).toBe(404);
  expect(action).not.toHaveBeenCalled();
});
