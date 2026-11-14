import { describe, expect, it } from "vitest";
import { SocialProviderError } from "../../src/server/social/port";
import { canTransition, classifyFailure, legalTransitions, postStatuses, retryDelaySeconds } from "../../src/server/social/state";

describe("social post state machine (service mirror of the database trigger)", () => {
  it("has terminal published and cancelled states", () => {
    expect(legalTransitions.published).toEqual([]); expect(legalTransitions.cancelled).toEqual([]);
  });
  it("only allows the documented moves", () => {
    const allowed = new Set(Object.entries(legalTransitions).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`)));
    expect([...allowed].sort()).toEqual(["draft>cancelled", "draft>draft", "draft>scheduled", "failed>cancelled", "failed>scheduled", "publishing>failed", "publishing>published", "publishing>publishing",
      "publishing>scheduled", "scheduled>cancelled", "scheduled>draft", "scheduled>failed", "scheduled>publishing", "scheduled>scheduled"]);
    expect(postStatuses.flatMap((a) => postStatuses.map((b) => canTransition(a, b) === allowed.has(`${a}>${b}`))).every(Boolean)).toBe(true);
    // A draft can never be published without being scheduled first; a cancelled post never comes back.
    expect(canTransition("draft", "publishing")).toBe(false); expect(canTransition("cancelled", "scheduled")).toBe(false); expect(canTransition("published", "failed")).toBe(false);
  });
});
describe("failure classification", () => {
  it("retries rate limits and outages, fails everything else at once", () => {
    expect(classifyFailure(new SocialProviderError("UNAVAILABLE"), 1)).toEqual({ outcome: "retry", code: "PROVIDER_UNAVAILABLE", delaySeconds: 30 });
    expect(classifyFailure(new SocialProviderError("UNAVAILABLE"), 3)).toMatchObject({ outcome: "retry", delaySeconds: 120 });
    expect(classifyFailure(new SocialProviderError("RATE_LIMITED", 90_000), 1)).toEqual({ outcome: "retry", code: "PROVIDER_RATE_LIMITED", delaySeconds: 90 });
    expect(classifyFailure(new SocialProviderError("RATE_LIMITED", 99_999_000), 1).delaySeconds).toBe(3600);
    for (const [code, expected] of [["AUTH", "PROVIDER_AUTH"], ["CONFLICT", "PROVIDER_CONFLICT"], ["INVALID_REQUEST", "PROVIDER_REJECTED"], ["NOT_FOUND", "PROVIDER_REJECTED"], ["DISABLED", "DISABLED"]] as const) {
      expect(classifyFailure(new SocialProviderError(code), 1)).toEqual({ outcome: "failed", code: expected, delaySeconds: 0 });
    }
  });
  it("treats an unrecognised error as transient and caps the backoff at an hour", () => {
    expect(classifyFailure(new Error("boom"), 1).outcome).toBe("retry");
    expect(retryDelaySeconds(1)).toBe(30); expect(retryDelaySeconds(50)).toBe(3600);
  });
});
