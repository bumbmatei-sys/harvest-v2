import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/db/client")>(),
  getDb: () => f.db,
}));
vi.mock("../../src/server/http", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/server/http")>(),
  verifiedUser: async () => owner,
  verifyOrigin: () => {},
}));
import { POST } from "../../src/app/api/workspaces/[tenantId]/ownership-transfer/route";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { accountDeletionBlockers, deleteMyAccount } from "../../src/server/account-deletion";
import { withTenant } from "../../src/server/tenancy";
import { listOwnershipNotifications, markOwnershipNotifications, ownershipTransfer } from "../../src/server/ownership-transfer";

const owner = "transfer-owner", admin = "transfer-admin", member = "transfer-member", outsider = "transfer-outsider";
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string;
const offer = () => ownershipTransfer(f.db, owner, tenant, { action: "offer", recipientUserId: admin });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  for (const id of [owner, admin, member, outsider]) await f.db.insert(schema.users).values({ id, name: id, email: `${id}@example.invalid`, emailVerified: true });
  tenant = (await createWorkspace(f.db, owner, "Transfer Ministry", "church")).tenantId;
  other = (await createWorkspace(f.db, outsider, "Other Ministry", "church")).tenantId;
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,'admin'), ($1,$3,'member'), ($4,$2,'admin')", [tenant, admin, member, other]);
}, 120_000);
afterAll(async () => { await f?.close(); });

it("requires an owner and an admin in the same ministry", async () => {
  await expect(withTenant(f.db, owner, tenant, "workspace:read", async tx => {
    await tx.execute(sql`select set_config('app.access_tenant',${tenant},true),set_config('app.access_token','forged',true)`);
    await tx.execute(sql`insert into audit_logs (tenant_id,actor_id,action,target_id)
      values (${tenant}::uuid,${owner},'ministry.ownership_transfer',${tenant})`);
  })).rejects.toThrow();
  await expect(ownershipTransfer(f.db, admin, tenant, { action: "offer", recipientUserId: member })).rejects.toMatchObject({ status: 403 });
  for (const recipientUserId of [member, outsider]) {
    await expect(ownershipTransfer(f.db, owner, tenant, { action: "offer", recipientUserId })).rejects.toMatchObject({ details: { code: "ineligible_recipient" } });
  }
  const { id } = await offer();
  await expect(offer()).rejects.toMatchObject({ details: { code: "pending_exists" } });
  await expect(ownershipTransfer(f.db, admin, other, { action: "accept", offerId: id! })).rejects.toMatchObject({ status: 404 });
  await expect(ownershipTransfer(f.db, member, tenant, { action: "accept", offerId: id! })).rejects.toMatchObject({ status: 404 });
  expect(await ownershipTransfer(f.db, owner, tenant, { action: "cancel", offerId: id! })).toEqual({ outcome: "cancelled" });
});

it("limits offers and cancellations together before the next notification", async () => {
  const { tenantId: workspace } = await createWorkspace(f.db, owner, "Limited Ministry", "church");
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,'admin')", [workspace, admin]);
  const post = (input: unknown) => POST(new Request("https://app.example.invalid", { method: "POST", body: JSON.stringify(input) }),
    { params: Promise.resolve({ tenantId: workspace }) });
  for (let i = 0; i < 3; i++) {
    const result = await post({ action: "offer", recipientUserId: admin });
    expect(result.status).toBe(201);
    const { id } = await result.json();
    expect((await post({ action: "cancel", offerId: id })).status).toBe(200);
  }
  const notices = await listOwnershipNotifications(f.db, admin, workspace);
  const blocked = await post({ action: "offer", recipientUserId: admin });
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(await listOwnershipNotifications(f.db, admin, workspace)).toEqual(notices);
  // Leave the shared owner fixture unchanged for the account deletion checks.
  await f.admin.query("delete from workspace_members where tenant_id=$1 and user_id=$2", [workspace, owner]);
});

it("handles decline and expiry without changing the roles", async () => {
  const { id } = await offer();
  expect(await ownershipTransfer(f.db, admin, tenant, { action: "decline", offerId: id! })).toEqual({ outcome: "declined" });
  const expiry = await offer();
  expect(Date.parse(expiry.expiresAt!) - Date.now()).toBeGreaterThan(13.99 * 86_400_000);
  await f.admin.query("update workspace_ownership_offers set expires_at=now()-interval '1 second' where id=$1", [expiry.id]);
  await expect(ownershipTransfer(f.db, admin, tenant, { action: "accept", offerId: expiry.id! })).rejects.toMatchObject({ details: { code: "expired" } });
  const status = await ownershipTransfer(f.db, admin, tenant, { action: "status", offerId: expiry.id });
  expect(status?.outcome).toBe("expired");
});

it("invalidates an offer even if an intervening role change was reversed", async () => {
  const { id } = await offer();
  await f.admin.query("update workspace_members set role_id='member' where tenant_id=$1 and user_id=$2", [tenant, admin]);
  await f.admin.query("update workspace_members set role_id='admin' where tenant_id=$1 and user_id=$2", [tenant, admin]);
  await expect(ownershipTransfer(f.db, admin, tenant, { action: "accept", offerId: id! })).rejects.toMatchObject({ details: { code: "membership_changed" } });
});

it("commits one concurrent acceptance, audits and notifies both people, and unlocks deletion", async () => {
  const { id } = await offer();
  const now = new Date();
  expect((await accountDeletionBlockers(f.db, owner)).ownershipTransfers).toEqual([
    { id: tenant, name: "Transfer Ministry", transferEndpoint: `/api/workspaces/${tenant}/ownership-transfer` },
  ]);
  await expect(deleteMyAccount(f.db, owner, now, { confirm: "DELETE" }, null, now)).rejects.toMatchObject({ details: { code: "SOLE_OWNER" } });
  const secondPool = new Pool({ connectionString: f.appURL, max: 1 });
  const secondDb = drizzle(secondPool, { schema });
  const accept = (db: typeof f.db) => ownershipTransfer(db, admin, tenant, { action: "accept", offerId: id! });
  const both = await Promise.allSettled([accept(f.db), accept(secondDb)]).finally(() => secondPool.end());
  expect(both.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
  expect((await f.admin.query("select user_id,role_id from workspace_members where tenant_id=$1 order by user_id", [tenant])).rows)
    .toEqual([{ user_id: admin, role_id: "owner" }, { user_id: member, role_id: "member" }, { user_id: owner, role_id: "admin" }]);
  const audit = (await f.admin.query("select metadata from audit_logs where target_id=$1 and action='ministry.ownership_transfer'", [id])).rows;
  expect(audit).toEqual(expect.arrayContaining([{ metadata: { outcome: "offered" } }, { metadata: { outcome: "accepted" } }, { metadata: { outcome: "already_closed" } }]));
  for (const recipient of [owner, admin]) {
    const result = await listOwnershipNotifications(f.db, recipient, tenant);
    expect(result.items.filter(n => n.offerId === id)).toHaveLength(2);
    expect((await markOwnershipNotifications(f.db, recipient, tenant, "all")).updated).toBeGreaterThan(0);
  }
  expect((await listOwnershipNotifications(f.db, member, tenant)).unread).toBe(0);
  expect((await accountDeletionBlockers(f.db, owner)).ownershipTransfers).toEqual([]);
  await expect(deleteMyAccount(f.db, owner, now, { confirm: "DELETE" }, null, now)).resolves.toHaveProperty("reference");
});
