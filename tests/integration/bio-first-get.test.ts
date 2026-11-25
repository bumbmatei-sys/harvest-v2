import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { getBioPage } from "../../src/server/link-in-bio";
import { testDatabase } from "../database";

let f: Awaited<ReturnType<typeof testDatabase>>;
const people = Array.from({ length: 8 }, (_, i) => `bf-u${i}`);
beforeAll(async () => {
  process.env.HARVEST_LINK_IN_BIO = process.env.HARVEST_LINK_IN_BIO ?? "1";
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
}, 60_000);
afterAll(async () => { await f?.close(); });

it("the owner's first read of a new ministry creates the page, also when other ministries share the name", async () => {
  for (const user of people.slice(0, 3)) {
    const tenant = (await createWorkspace(f.db, user, "Closed Ministry", "church")).tenantId;
    const view = await getBioPage(f.db, user, tenant);
    expect(view.status).toBe("draft");
  }
  const handles = (await f.admin.query("select handle from bio_pages")).rows.map((r) => r.handle);
  expect(new Set(handles).size).toBe(3);
});

it("parallel first reads of one ministry all succeed and create one page", async () => {
  const tenant = (await createWorkspace(f.db, people[3], "Parallel Ministry", "church")).tenantId;
  const views = await Promise.allSettled(Array.from({ length: 6 }, () => getBioPage(f.db, people[3], tenant)));
  expect(views.map((v) => v.status === "fulfilled" ? "ok" : String((v as PromiseRejectedResult).reason?.message ?? v))).toEqual(Array(6).fill("ok"));
  expect((await f.admin.query("select count(*)::int n from bio_pages where tenant_id=$1", [tenant])).rows[0].n).toBe(1);
});

it("parallel first reads of different ministries with the same name get different handles", async () => {
  const made = await Promise.all(people.slice(4, 8).map(async (user) => ({ user, tenant: (await createWorkspace(f.db, user, "Same Name Church", "church")).tenantId })));
  const results = await Promise.allSettled(made.map(({ user, tenant }) => getBioPage(f.db, user, tenant)));
  expect(results.map((r) => r.status === "fulfilled" ? "ok" : String((r as PromiseRejectedResult).reason?.message ?? r))).toEqual(Array(4).fill("ok"));
});

// The route as the browser calls it: session, tenant in the path, JSON out.
vi.mock("@/db/client", () => ({ getDb: () => f.db }));
vi.mock("@/server/http", async (original) => ({
  ...await original<typeof import("../../src/server/http")>(),
  verifiedSessionUser: async (request: Request) => { const id = request.headers.get("x-test-user"); if (!id) throw new (await import("../../src/server/permissions")).AccessError(401, "Sign in to continue."); return { id }; },
}));
it("the owner's GET right after creating a ministry answers 200 through the route, with other bio pages present", async () => {
  const { GET } = await import("../../src/app/api/workspaces/[tenantId]/link-in-bio/route");
  const get = (user: string, tenantId: string) => GET(new Request("http://localhost/x", { headers: { "x-test-user": user } }), { params: Promise.resolve({ tenantId }) });
  for (let i = 0; i < 4; i++) {
    const tenant = (await createWorkspace(f.db, people[i], "Closed Ministry", "church")).tenantId;
    const response = await get(people[i], tenant);
    expect(response.status, await response.clone().text()).toBe(200);
    // Somebody else is refused.
    expect((await get(people[(i + 1) % 8], tenant)).status).toBe(403);
  }
});
