import { describe, expect, it } from "vitest";
import { CONNECT_RETENTION_POLICY, suppressSmall } from "@/lib/connect-retention";

describe("suppressSmall", () => {
  it("hides counts of 1 to 4 and shows zero and counts of 5 or more", () => {
    expect([0, 1, 2, 4, 5, 6, 100].map((n) => suppressSmall(n))).toEqual([0, null, null, null, 5, 6, 100]);
  });
  it("takes another minimum, and hides anything that is not a count", () => {
    expect([suppressSmall(9, 10), suppressSmall(10, 10)]).toEqual([null, 10]);
    expect([suppressSmall(-1), suppressSmall(Number.NaN), suppressSmall(Infinity)]).toEqual([null, null, null]);
  });
});

describe("policy", () => {
  it("holds the directions selected by the founder (13 Nov 2026), pending legal review", () => {
    expect(CONNECT_RETENTION_POLICY).toEqual({ maxPendingDays: 30, tombstoneDays: 90, smallGroupMin: 5, healthWindowHours: 26 });
  });
});
