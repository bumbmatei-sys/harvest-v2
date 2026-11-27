import { describe, expect, it } from "vitest";
import { changedThisWeek, fillShelf, freeShelfUseful, shelfMinTotal, shelfSize, shelvesAllowed } from "../../src/lib/discover-shelves";
import { timeLeft } from "../../src/components/discover/sale-line";

const browse = { sort: "relevance" as const };
describe("Discover shelves", () => {
  it("show only on the plain browse view with enough listings", () => {
    expect(shelvesAllowed(browse, shelfMinTotal)).toBe(true);
    expect(shelvesAllowed({ ...browse, type: "course" }, shelfMinTotal)).toBe(true);
    expect(shelvesAllowed(browse, shelfMinTotal - 1)).toBe(false);
    for (const filters of [{ q: "prayer" }, { category: "prayer" as const }, { language: "en" }, { free: true }, { free: false }, { sort: "newest" as const }])
      expect(shelvesAllowed({ ...browse, ...filters }, 50), JSON.stringify(filters)).toBe(false);
  });
  it("drop a shelf with too few cards and cap the rest", () => {
    expect(fillShelf([1, 2])).toEqual([]);
    expect(fillShelf([1, 2, 3])).toEqual([1, 2, 3]);
    expect(fillShelf(Array.from({ length: 30 }, (_, i) => i))).toHaveLength(shelfSize);
  });
  it("keeps the past seven days for New this week and hides Free to start when everything is free", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const items = [{ updatedAt: "2026-11-27T10:00:00Z" }, { updatedAt: "2026-11-20T12:00:00Z" }, { updatedAt: "2026-11-19T11:59:00Z" }];
    expect(changedThisWeek(items, now)).toEqual(items.slice(0, 2));
    expect(freeShelfUseful(10, 10)).toBe(false);
    expect(freeShelfUseful(4, 10)).toBe(true);
  });
  it("counts a sale down in days, hours and minutes and never below zero", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    expect(timeLeft("2026-11-29T11:30:00Z", now)).toEqual({ days: 1, hours: 23, minutes: 30, over: false });
    expect(timeLeft("2026-11-27T11:00:00Z", now)).toMatchObject({ days: 0, hours: 0, minutes: 0, over: true });
  });
});
