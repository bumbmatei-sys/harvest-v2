import { describe, expect, it } from "vitest";
import { pollingDelay, retryAfterDelay } from "@/hooks/use-polling";

describe("polling intervals", () => {
  const active = { mode: "active", focused: true, idleMs: 0, failures: 0 } as const;

  it("jitters an active channel's four-second interval by one second", () => {
    expect(pollingDelay({ ...active, jitter: 0 })).toBe(3_000);
    expect(pollingDelay({ ...active, jitter: 0.5 })).toBe(4_000);
    expect(pollingDelay({ ...active, jitter: 1 })).toBe(5_000);
  });

  it("slows down when unfocused or idle and keeps the rail on its own interval", () => {
    expect(pollingDelay({ ...active, focused: false })).toBe(15_000);
    expect(pollingDelay({ ...active, idleMs: 120_000 })).toBe(15_000);
    expect(pollingDelay({ ...active, idleMs: 300_000 })).toBe(30_000);
    expect(pollingDelay({ ...active, mode: "rail", idleMs: 300_000 })).toBe(15_000);
  });

  it("doubles the interval for each failure up to a minute and uses the advertised interval in milliseconds", () => {
    expect(pollingDelay({ ...active, jitter: 0.5, failures: 2 })).toBe(16_000);
    expect(pollingDelay({ ...active, jitter: 0.5, failures: 10 })).toBe(60_000);
    expect(pollingDelay({ ...active, jitter: 0.5, serverIntervalMs: 10_000 })).toBe(10_000);
  });

  it("accepts delay-seconds and HTTP dates for Retry-After", () => {
    const now = Date.parse("Tue, 17 Nov 2026 21:00:00 GMT");
    expect(retryAfterDelay("90", now)).toBe(90_000);
    expect(retryAfterDelay("Tue, 17 Nov 2026 21:00:30 GMT", now)).toBe(30_000);
    expect(retryAfterDelay("Tue, 17 Nov 2026 20:59:59 GMT", now)).toBe(0);
    expect(retryAfterDelay("invalid", now)).toBe(0);
    expect(retryAfterDelay(null, now)).toBe(0);
  });
});
