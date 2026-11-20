import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import { requireSocialScreens, socialPublishGateOpen, socialRouteDeps } from "../../src/server/social-publish-gate";
import { SOCIAL_INTEGRATION_ENABLED, getSocialSender } from "../../src/server/social/registry";
import { platformCharacterCounters } from "../../src/lib/social/characters";

describe("non-production Publish gate", () => {
  it("is open in development and test", () => {
    expect(socialPublishGateOpen({ NODE_ENV: "development" })).toBe(true);
    expect(socialPublishGateOpen({ NODE_ENV: "test" })).toBe(true);
    expect(socialRouteDeps({ NODE_ENV: "test" }).enabled).toBe(true);
  });
  it("is closed in production, even with the communities switch or a preview build flag", () => {
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" }, { NODE_ENV: "development", VERCEL_ENV: "production" }, { NODE_ENV: "test", VERCEL_ENV: "production", HARVEST_COMMUNITIES: "enabled" }]) {
      expect(socialPublishGateOpen(env), JSON.stringify(env)).toBe(false);
      expect(socialRouteDeps(env).enabled, JSON.stringify(env)).toBe(false);
    }
  });
  it("uses only the fake provider and never hands out a sender; the hard-off constants stay false", () => {
    expect(socialRouteDeps({ NODE_ENV: "test" }).provider("fake").id).toBe("fake");
    expect(() => socialRouteDeps({ NODE_ENV: "test" }).provider("zernio")).toThrow();
    expect(() => getSocialSender()).toThrow("SOCIAL_SENDING_NOT_AVAILABLE");
    expect(SOCIAL_INTEGRATION_ENABLED).toBe(false);
  });
  it("answers not found for the pages when the gate is closed", () => {
    const before = process.env.NODE_ENV;
    expect(() => requireSocialScreens()).not.toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => requireSocialScreens()).toThrow("NOT_FOUND");
    vi.unstubAllEnvs(); expect(process.env.NODE_ENV).toBe(before);
  });
});

describe("shared character counter", () => {
  it("counts graphemes with an explicit locale so server and browser agree", () => {
    expect(platformCharacterCounters.bluesky("👨‍👩‍👧 क्षि", {}).used).toBe(3);
    expect(platformCharacterCounters.bluesky("a\r\nb", {}).used).toBe(3);
  });
});
