import { afterEach, expect, it, vi } from "vitest";
import { catalogRoute } from "../../src/server/free-catalog-route";
import { freeCatalogEnabled } from "../../src/server/free-catalog-mode";

const mock = vi.hoisted(() => ({ getDb: vi.fn(), verifiedUser: vi.fn(), verifyOrigin: vi.fn() }));
vi.mock("../../src/db/client", () => ({ getDb: mock.getDb }));
vi.mock("../../src/server/http", () => ({ verifiedUser: mock.verifiedUser, verifyOrigin: mock.verifyOrigin }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("allows local work and keeps both production environments off with the flag enabled", () => {
  expect(freeCatalogEnabled({ NODE_ENV: "test" })).toBe(true);
  expect(freeCatalogEnabled({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" })).toBe(false);
  expect(freeCatalogEnabled({ NODE_ENV: "test", VERCEL_ENV: "production", HARVEST_COMMUNITIES: "enabled" })).toBe(false);
});

it.each(["public", "read", "write"] as const)("returns an empty 404 before auth, origin and DB work for %s requests", async (mode) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  const handler = vi.fn();
  const request = new Request("https://harvest.example.test/api/catalog/free-course", {
    headers: { "x-harvest-communities": "enabled", "x-forwarded-host": "preview.example.test" },
  });
  const response = await catalogRoute(handler, mode)(request, { params: Promise.resolve({}) });
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
  expect(handler).not.toHaveBeenCalled();
  expect(mock.getDb).not.toHaveBeenCalled();
  expect(mock.verifiedUser).not.toHaveBeenCalled();
  expect(mock.verifyOrigin).not.toHaveBeenCalled();
});
