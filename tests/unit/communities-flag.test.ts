import { afterEach, expect, it, vi } from "vitest";
import { navEntries, resolveNavigation } from "../../src/lib/navigation";

// C04 review on #58: with the production default (no HARVEST_COMMUNITIES) every Communities API returns 404
// before authentication or the database is touched.
vi.mock("server-only", () => ({}));
const touched = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => { touched("db"); throw new Error("database reached"); } }));
vi.mock("@/server/http", () => ({
  verifiedUser: () => { touched("auth"); throw new Error("auth reached"); },
  verifyOrigin: () => { touched("origin"); },
  errorResponse: () => new Response(null, { status: 500 }),
}));
afterEach(() => { vi.unstubAllEnvs(); touched.mockClear(); });

const ids = { tenantId: "00000000-0000-4000-8000-000000000001", communityId: "00000000-0000-4000-8000-000000000002" };
const context = { params: Promise.resolve(ids) };
const request = (method: string) => new Request("https://example.test/api", { method, headers: { origin: "https://example.test" }, body: method === "GET" ? undefined : "{}" });

it("returns 404 from every Communities route in production unless activated", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("HARVEST_COMMUNITIES", "");
  const list = await import("../../src/app/api/workspaces/[tenantId]/communities/route");
  const one = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/route");
  const publish = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/publish/route");
  const calls = [list.GET(request("GET"), context), list.POST(request("POST"), context), one.GET(request("GET"), context), one.PATCH(request("PATCH"), context), publish.POST(request("POST"), context)];
  for (const response of await Promise.all(calls)) expect(response.status).toBe(404);
  expect(touched).not.toHaveBeenCalled();
});

it("reaches authentication once activated", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  const list = await import("../../src/app/api/workspaces/[tenantId]/communities/route");
  expect((await list.GET(request("GET"), context)).status).toBe(500);
  expect(touched).toHaveBeenCalledWith("auth");
});

it("shows Communities in the navigation only when the feature is on", () => {
  const ids = (features?: readonly "communities"[]) => resolveNavigation({ tenantId: "00000000-0000-4000-8000-000000000001", role: "owner", pathname: "/", features }).flatMap((group) => group.items.map((item) => item.id));
  expect(navEntries.find((entry) => entry.id === "communities")?.feature).toBe("communities");
  expect(ids()).not.toContain("communities");
  expect(ids(["communities"])).toContain("communities");
});
