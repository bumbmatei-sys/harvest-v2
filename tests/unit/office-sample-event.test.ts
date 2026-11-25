import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { sampleEventWindow } from "../../src/server/office-provider/fake-provider";

const day = (date: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, dateStyle: "short" }).format(date);

describe("demo calendar sample event", () => {
  it("never spans midnight, in UTC or in any half-hour zone, whatever time the demo is connected", () => {
    const zones = ["UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Australia/Adelaide", "Pacific/Auckland"];
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const now = new Date(Date.UTC(2026, 10, 24, 0, minute));
      const { start, end } = sampleEventWindow(now);
      expect(start.getTime() - now.getTime(), `upcoming at ${now.toISOString()}`).toBeGreaterThanOrEqual(3_600_000);
      expect(end.getTime() - start.getTime()).toBe(30 * 60_000);
      // The end instant is exclusive: the last minute of the event must be on the start's day.
      const last = new Date(end.getTime() - 60_000);
      for (const zone of zones) expect(day(last, zone), `${zone} at ${now.toISOString()}`).toBe(day(start, zone));
    }
  });
  it("is the next whole hour at least an hour away", () => {
    expect(sampleEventWindow(new Date("2026-11-24T23:40:00Z")).start.toISOString()).toBe("2026-11-25T01:00:00.000Z");
    expect(sampleEventWindow(new Date("2026-11-24T22:40:00Z")).start.toISOString()).toBe("2026-11-25T00:00:00.000Z");
    expect(sampleEventWindow(new Date("2026-11-24T10:00:00Z")).start.toISOString()).toBe("2026-11-24T11:00:00.000Z");
  });
});
