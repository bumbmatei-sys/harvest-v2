import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", async original => ({ ...await original<typeof import("../../src/db/client")>(), getDb: () => f.db }));
import { GET } from "../../src/app/api/public/ministries/[tenantId]/profile/route";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { ministryProfileImage, publicMinistryProfile, readMinistryProfile, saveMinistryProfile } from "../../src/server/ministry-profile";
import { withUser } from "../../src/server/tenancy";

const owner = "profile-owner", admin = "profile-admin", member = "profile-member", outsider = "profile-outsider";
const miss = { status: 404 };
const location = { name: "Chapel", address1: "1 A & B #2", city: "München", country: "DE", primary: true, visibility: "public" };
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string;
const ctx = () => ({ params: Promise.resolve({ tenantId: tenant }) });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, admin, member, outsider].map(id => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Profile tenant", "church")).tenantId;
  other = (await createWorkspace(f.db, outsider, "Outside tenant", "church")).tenantId;
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,'admin'), ($1,$3,'member')", [tenant, admin, member]);
}, 120_000);
afterAll(async () => { await f?.close(); });

it("projects only published fields at each visibility and denies cross-ministry direct reads", async () => {
  await saveMinistryProfile(f.db, owner, tenant, { version: 0, fields: {
    name: { value: "Public name", visibility: "public" },
    website: { value: "https://ministry.example.invalid", visibility: "public" },
    email: { value: "private@example.invalid" },
    phone: { value: "+1 555 0100", visibility: "members" },
    tradition: { value: "Private tradition" },
  }, locations: [location, { ...location, primary: false, name: "Members' location", visibility: "members" },
    { ...location, primary: false, name: "Private location", visibility: "staff" }] });
  await expect(publicMinistryProfile(f.db, tenant)).rejects.toMatchObject(miss);
  await expect(readMinistryProfile(f.db, member, tenant)).rejects.toMatchObject(miss);
  await expect(saveMinistryProfile(f.db, admin, tenant, { version: 2, fields: {
    email: { value: "injected@example.invalid", visibility: "public" },
  } })).rejects.toMatchObject(miss);
  await saveMinistryProfile(f.db, admin, tenant, { version: 2, published: true });
  const response = await GET(new Request("https://app.example.invalid"), ctx());
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.fields).toEqual({ name: "Public name", website: "https://ministry.example.invalid" });
  expect(result.locations).toEqual([expect.objectContaining({ name: "Chapel", primary: true })]);
  expect(new URL(result.locations[0].mapsHref).searchParams.get("query")).toBe("1 A & B #2, München, DE");
  expect(result.locations[0].visibility).toBeUndefined();
  const members = await readMinistryProfile(f.db, member, tenant);
  expect(members.fields).toEqual({ ...result.fields, phone: "+1 555 0100" });
  expect(members.locations).toHaveLength(2);
  expect((await readMinistryProfile(f.db, admin, tenant)).locations).toHaveLength(3);
  await expect(readMinistryProfile(f.db, outsider, tenant)).rejects.toMatchObject(miss);
  await expect(publicMinistryProfile(f.db, other)).rejects.toMatchObject(miss);
  await expect(saveMinistryProfile(f.db, member, tenant, { version: 3 })).rejects.toMatchObject(miss);
  const direct = await withUser(f.db, outsider, async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant}, true)`);
    return tx.execute(sql`select field from ministry_profile_fields`);
  });
  expect(direct.rows).toEqual([]);
  await expect(f.workerPool.query("select * from ministry_profiles")).rejects.toMatchObject({ code: "42501" });
});

it("validates the single primary location and switches it atomically", async () => {
  await expect(saveMinistryProfile(f.db, admin, tenant, { version: 3, locations: [location, location] })).rejects.toThrow();
  const existing = (await readMinistryProfile(f.db, owner, tenant)).locations.map(place => ({
    id: place.id, name: place.name, address1: place.address1, address2: place.address2,
    city: place.city, region: place.region, postalCode: place.postalCode, country: place.country,
    serviceTimes: place.serviceTimes, visibility: place.visibility, primary: place.name === "Members' location",
  }));
  await saveMinistryProfile(f.db, owner, tenant, { version: 3, locations: existing, fields: {
    email: { value: "published@example.invalid", visibility: "public" },
  } });
  expect((await readMinistryProfile(f.db, member, tenant)).locations[0]).toMatchObject({ name: "Members' location", primary: true });
  expect((await publicMinistryProfile(f.db, tenant)).fields.email).toBe("published@example.invalid");
});

it("resolves only a visible ready image and never exposes its storage key in the profile", async () => {
  const insert = async (scope: string, who: string) => {
    const id = randomUUID();
    await f.admin.query("insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,status) values($1,$2,$3,$4,'logo.png','image/png',10,repeat('a',64),'ready')",
      [id, scope, who, `workspaces/${scope}/files/${id}`]);
    return id;
  };
  const file = await insert(tenant, owner), foreign = await insert(other, outsider);
  await expect(saveMinistryProfile(f.db, owner, tenant, { version: 4, fields: { logo: { value: foreign } } })).rejects.toMatchObject(miss);
  await saveMinistryProfile(f.db, owner, tenant, { version: 4, fields: {
    cover: { value: file, visibility: "staff" }, logo: { value: file, visibility: "public" },
  } });
  expect((await publicMinistryProfile(f.db, tenant)).fields).toMatchObject({ logo: expect.stringContaining("/profile/images/logo") });
  expect((await publicMinistryProfile(f.db, tenant)).fields.cover).toBeUndefined();
  const signer = vi.fn(async () => "https://assets.example.invalid/signed");
  const storage = () => ({ presignDownload: signer, presignUpload: vi.fn(), inspect: vi.fn() });
  await expect(ministryProfileImage(f.db, storage, tenant, "logo")).resolves.toBe("https://assets.example.invalid/signed");
  await expect(ministryProfileImage(f.db, storage, tenant, "cover")).rejects.toMatchObject(miss);
  await expect(ministryProfileImage(f.db, storage, tenant, "cover", member)).rejects.toMatchObject(miss);
  await expect(ministryProfileImage(f.db, storage, tenant, "cover", admin)).resolves.toBe("https://assets.example.invalid/signed");
});
