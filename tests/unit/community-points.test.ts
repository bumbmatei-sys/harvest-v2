import { expect, it } from "vitest";
import { pointMutation, pointSettings } from "../../src/server/community-points";

it("requires increasing thresholds and bounded nonnegative weights", () => {
  const settings = { enabled: true, post: 0, reply: 2, lesson: 10, event: 15, thresholds: [25, 100, 250] };
  expect(pointSettings.safeParse(settings).success).toBe(true);
  expect(pointSettings.safeParse({ ...settings, thresholds: [25, 25] }).success).toBe(false);
  expect(pointSettings.safeParse({ ...settings, event: -1 }).success).toBe(false);
});

it("bounds challenge dates, actions and counts", () => {
  const input = { title: "First post", startsAt: "2026-11-27T08:00:00Z", endsAt: "2026-11-28T08:00:00Z", goal: "post", target: 1 };
  expect(pointMutation.safeParse({ action: "create", input }).success).toBe(true);
  expect(pointMutation.safeParse({ action: "create", input: { ...input, endsAt: input.startsAt } }).success).toBe(false);
  expect(pointMutation.safeParse({ action: "create", input: { ...input, goal: "like" } }).success).toBe(false);
});
