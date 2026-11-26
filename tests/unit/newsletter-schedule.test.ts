import { describe, expect, it } from "vitest";
import { formatScheduled, scheduleInputValue, zonedSchedule } from "../../src/lib/newsletter-schedule";

describe("zonedSchedule", () => {
  it("adds seconds and the zone's own offset", () => {
    expect(zonedSchedule("2026-12-06T09:00", "America/Chicago")).toEqual({ at: "2026-12-06T09:00:00-06:00", timezone: "America/Chicago" });
    expect(zonedSchedule("2026-07-06T09:00", "America/Chicago")).toEqual({ at: "2026-07-06T09:00:00-05:00", timezone: "America/Chicago" });
    expect(zonedSchedule("2026-12-06T09:00", "Asia/Kolkata")?.at).toBe("2026-12-06T09:00:00+05:30");
    expect(zonedSchedule("2026-12-06T09:00", "UTC")?.at).toBe("2026-12-06T09:00:00+00:00");
  });
  it("refuses a wall time that does not exist and picks the earlier instant of a repeated one", () => {
    expect(zonedSchedule("2026-03-08T02:30", "America/Chicago")).toBeNull();
    expect(zonedSchedule("2026-11-01T01:30", "America/Chicago")?.at).toBe("2026-11-01T01:30:00-05:00");
    expect(zonedSchedule("not a date", "UTC")).toBeNull();
  });
  it("matches the server's local-time check and round-trips the input value", () => {
    const schedule = zonedSchedule("2026-12-06T09:00", "Europe/Bucharest")!;
    expect(scheduleInputValue(schedule.at, "Europe/Bucharest")).toBe("2026-12-06T09:00");
    expect(formatScheduled(schedule.at, "Europe/Bucharest")).toContain("9:00");
  });
});
