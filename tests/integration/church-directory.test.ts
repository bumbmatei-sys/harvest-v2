import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", async original => ({
  ...await original<typeof import("../../src/db/client")>(), getDb: () => f.db,
}));
import { sql } from "drizzle-orm";
import { GET } from "../../src/app/api/public/churches/route";
import { users } from "../../src/db/schema";
import { searchChurchDirectory, setChurchDirectoryOptIn } from "../../src/server/church-directory";
import { saveMinistryProfile } from "../../src/server/ministry-profile";
import { withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "directory-owner", outsider = "directory-outsider";
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string;
const all = { name: null, cityRegion: null, after: null };

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, outsider].map(id => ({ id, name: id, email: `${id}@example.invalid` })));
  tenant = (await createWorkspace(f.db, owner, "Directory fixture", "church")).tenantId;
  await saveMinistryProfile(f.db, owner, tenant, {
    version: 0, published: true,
    fields: {
      name: { value: "Grace Chapel", visibility: "public" },
      website: { value: "https://grace.example.invalid", visibility: "public" },
      email: { value: "private@example.invalid", visibility: "staff" },
      tradition: { value: "Members only", visibility: "members" },
    },
    locations: [
      { name: "Chapel", address1: "1 Example Road", city: "Lincoln", region: "Midlands", country: "GB", primary: true, visibility: "public" },
      { name: "Private address", address1: "2 Example Road", city: "Private City", country: "GB", primary: false, visibility: "staff" },
    ],
  });
}, 120_000);
afterAll(async () => { await f?.close(); });

it("requires both verification and opt-in and searches only public profile values", async () => {
  await expect(setChurchDirectoryOptIn(f.db, outsider, tenant, { optedIn: true })).rejects.toMatchObject({ status: 404 });
  await setChurchDirectoryOptIn(f.db, owner, tenant, { optedIn: true });
  expect(await searchChurchDirectory(f.db, all)).toEqual({ items: [], next: null });

  await f.admin.query("update church_directory_entries set verified_at = now() where tenant_id = $1", [tenant]);
  for (const cityRegion of ["lincoln", "MIDLANDS"]) {
    const response = await GET(new Request(`https://app.example.invalid/api/public/churches?name=grace&cityRegion=${cityRegion}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{
      ministryId: tenant, name: "Grace Chapel", fields: { website: "https://grace.example.invalid" },
      locations: [{ name: "Chapel", city: "Lincoln", region: "Midlands", country: "GB", serviceTimes: [] }],
    }], next: null });
  }
  expect(await searchChurchDirectory(f.db, { ...all, cityRegion: "Private City" })).toEqual({ items: [], next: null });
  expect(await searchChurchDirectory(f.db, { ...all, name: "%" })).toEqual({ items: [], next: null });
  await setChurchDirectoryOptIn(f.db, owner, tenant, { optedIn: false });
  expect(await searchChurchDirectory(f.db, all)).toEqual({ items: [], next: null });
});

it("prevents application and worker table access even with an injected setting", async () => {
  await expect(withUser(f.db, owner, async tx => {
    await tx.execute(sql`select set_config('app.church_directory_read', 'on', true)`);
    return tx.execute(sql`update public.church_directory_entries set verified_at = now()`);
  })).rejects.toThrow();
  await expect(f.workerPool.query("select * from public.church_directory_entries")).rejects.toMatchObject({ code: "42501" });
});
