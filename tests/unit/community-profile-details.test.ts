import { afterEach, expect, it, vi } from "vitest";
import { memberProfileRoute, memberProfilesEnabled } from "../../src/server/community-profile-details";

const routed = vi.hoisted(() => vi.fn());
vi.mock("../../src/server/community-route", () => ({ communityRoute: () => routed }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("requires a non-production environment even when Communities is enabled", () => {
  expect(memberProfilesEnabled({ NODE_ENV: "test" })).toBe(true);
  expect(memberProfilesEnabled({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" })).toBe(false);
  expect(memberProfilesEnabled({ NODE_ENV: "test", VERCEL_ENV: "production" })).toBe(false);
});

it("returns a production 404 before the common route reads authentication", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  const request = new Request("https://harvest.example.test/api/communities/test/members/member", {
    headers: { "x-vercel-env": "preview", "x-harvest-communities": "enabled" },
  });
  const response = await memberProfileRoute(vi.fn(), true)(request, { params: Promise.resolve({}) });
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
  expect(routed).not.toHaveBeenCalled();
});
