import { describe, expect, it } from "vitest";
import { accountIssues, addDays, analyticsQuery, bestSlot, daysInRange, deltaOf, hasAnyValue, heatLevel, matchPreset, maxHeat, parseScope, presetRange, previousRange, rangeIsValid, scopeValue, todayIn, type AccountReport, type HeatCell } from "../../src/lib/social/analytics-view";
import { navEntries } from "../../src/lib/navigation";

const reading = (value: number | null) => ({ value, availability: value === null ? "unavailable" as const : "available" as const });
describe("analytics view helpers", () => {
  it("builds inclusive ranges and the period before", () => {
    expect(presetRange(7, "2026-11-20")).toEqual({ from: "2026-11-14", to: "2026-11-20" });
    expect(daysInRange("2026-11-14", "2026-11-20")).toBe(7);
    expect(previousRange("2026-11-14", "2026-11-20")).toEqual({ from: "2026-11-07", to: "2026-11-13" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(matchPreset("2026-11-14", "2026-11-20", "2026-11-20")).toBe(7);
    expect(matchPreset("2026-11-01", "2026-11-20", "2026-11-20")).toBeNull();
  });
  it("validates a custom range the way the route does (at most 366 days)", () => {
    expect(rangeIsValid("2026-01-01", "2026-12-31")).toBe(true);
    expect(rangeIsValid("2025-11-19", "2026-11-20")).toBe(false);
    expect(rangeIsValid("2026-11-20", "2026-11-19")).toBe(false);
    expect(rangeIsValid("nope", "2026-11-19")).toBe(false);
  });
  it("reads today's date in a zone", () => {
    const now = new Date("2026-11-20T23:30:00Z");
    expect(todayIn("UTC", now)).toBe("2026-11-20");
    expect(todayIn("Pacific/Auckland", now)).toBe("2026-11-21");
    expect(todayIn("Not/AZone", now)).toBe("2026-11-20");
  });
  it("round-trips a scope and builds the query", () => {
    expect(parseScope(scopeValue({ kind: "platform", platform: "youtube" }))).toEqual({ kind: "platform", platform: "youtube" });
    expect(parseScope("account:abc")).toEqual({ kind: "account", id: "abc" });
    expect(parseScope("all")).toEqual({ kind: "all" });
    expect(analyticsQuery({ from: "2026-11-01", to: "2026-11-02" }, "UTC", { kind: "account", id: "x" }, "reach").toString()).toBe("from=2026-11-01&to=2026-11-02&timezone=UTC&metric=reach&connectionId=x");
  });
  it("never turns an unavailable reading into a change", () => {
    expect(deltaOf(reading(null), reading(5))).toBeNull();
    expect(deltaOf(reading(5), reading(null))).toBeNull();
    expect(deltaOf(reading(15), reading(10))).toEqual({ direction: "up", difference: 5, percent: 50 });
    expect(deltaOf(reading(5), reading(10))).toMatchObject({ direction: "down", percent: -50 });
    expect(deltaOf(reading(4), reading(0))).toEqual({ direction: "up", difference: 4, percent: null });
    expect(deltaOf(reading(0), reading(0))).toMatchObject({ direction: "flat" });
  });
  it("tells a drawn series from a wholly unavailable one", () => {
    expect(hasAnyValue([{ day: "a", ...reading(null) }])).toBe(false);
    expect(hasAnyValue([{ day: "a", ...reading(null) }, { day: "b", ...reading(0) }])).toBe(true);
  });
  it("scales and ranks heatmap cells without treating no data as zero", () => {
    const cells: HeatCell[] = [{ day: 0, hour: 1, averageEngagement: null, samples: 0 }, { day: 1, hour: 2, averageEngagement: 4, samples: 2 }, { day: 2, hour: 3, averageEngagement: 8, samples: 1 }];
    expect(maxHeat(cells)).toBe(8);
    expect(bestSlot(cells)).toMatchObject({ day: 2, hour: 3 });
    expect(bestSlot([cells[0]])).toBeNull();
    expect(heatLevel(null, 8)).toBe(0);
    expect(heatLevel(8, 8)).toBe(1);
    expect(heatLevel(0, 8)).toBeGreaterThan(0);
  });
  it("groups accounts by what is wrong with them", () => {
    const account = (status: AccountReport["status"]) => ({ id: status, status } as AccountReport);
    const issues = accountIssues([account("ready"), account("expired"), account("delayed"), account("partial"), account("pending"), account("unavailable")]);
    expect([issues.expired.length, issues.delayed.length, issues.pending.length, issues.unavailable.length]).toEqual([1, 2, 1, 1]);
  });
});

describe("analytics navigation entry", () => {
  it("is live under Social media with its own icon", () => {
    const entry = navEntries.find((item) => item.id === "socialAnalytics")!;
    expect(entry).toMatchObject({ group: "publishing", mode: "public", permission: "social:analytics", path: "/social/analytics" });
    expect(entry.status).not.toBe("planned");
    const others = navEntries.filter((item) => item.id !== "socialAnalytics" && item.status !== "planned" || item.id === "newsletterAnalytics");
    expect(others.some((item) => item.icon === entry.icon)).toBe(false);
  });
});
