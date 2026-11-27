import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { accountDeletionBlockers, deleteMyAccount } from "../../src/server/account-deletion";
import { listOwnershipNotifications, markOwnershipNotifications, ownershipTransfer } from "../../src/server/ownership-transfer";

const owner = "transfer-owner", admin = "transfer-admin", member = "transfer-member", outsider = "transfer-outsider";
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string;
const offer = () => ownershipTransfer(f.db, owner, tenant, { action: "offer", recipientUserId: admin });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  for (const id of [owner, admin, member, outsider]) await f.db.insert(users).values({ id, name: id, email: `${id}@example.invalid`, emailVerified: true });
  tenant = (await createWorkspace(f.db, owner, "Transfer Ministry", "church")).tenantId;
  other = (await createWorkspace(f.db, outsider, "Other Ministry", "church")).tenantId;
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,'admin'), ($1,$3,'member'), ($4,$2,'admin')", [tenant, admin, member, other]);
}, 120_000);
afterAll(async () => { await f?.close(); });

it("requires an owner and an admin in the same ministry", async () => {
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
  const accept = () => ownershipTransfer(f.db, admin, tenant, { action: "accept", offerId: id! });
  const both = await Promise.allSettled([accept(), accept()]);
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
