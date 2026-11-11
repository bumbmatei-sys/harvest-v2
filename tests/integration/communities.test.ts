import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { communities, users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { communityAccess, createCommunity, grantCommunityAccess, listCommunities, revokeEntitlement, updateCommunity } from "../../src/server/communities";

// ADR 0013 (C02/C03): two ministries, several communities. Staff reach their own ministry's communities;
// members reach a community only through their own active membership plus a valid grant.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, a1: string, a2: string, b1: string;
const people = ["c-a-owner", "c-a-viewer", "c-b-owner", "c-mem1", "c-mem2", "c-banned", "c-pending"];

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "c-a-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "c-b-owner", "Solo Creator", "creator")).tenantId;
  await putMember(f.db, "c-a-owner", a, "c-a-viewer@example.test", "viewer");
  a1 = (await createCommunity(f.db, "c-a-owner", a, { name: "Bible study", slug: "grace-bible-study" })).id;
  a2 = (await createCommunity(f.db, "c-a-owner", a, { name: "Leaders", slug: "grace-leaders", tagline: "Leadership team" })).id;
  b1 = (await createCommunity(f.db, "c-b-owner", b, { name: "Creator circle", slug: "creator-circle" })).id;
});
afterAll(async () => { await f?.close(); });

it("creates a private free draft with the creator as active owner, and audits it", async () => {
  const [row] = await f.admin.query("select status, visibility, pricing, allow_open, allow_invite, created_by from communities where id = $1", [a1]).then((r) => r.rows);
  expect(row).toEqual({ status: "draft", visibility: "hidden", pricing: "free", allow_open: false, allow_invite: true, created_by: "c-a-owner" });
  expect((await f.admin.query("select role, status from community_memberships where community_id = $1", [a1])).rows).toEqual([{ role: "owner", status: "active" }]);
  expect((await f.admin.query("select actor_id from audit_logs where action = 'community.create' and target_id = $1", [a1])).rows).toEqual([{ actor_id: "c-a-owner" }]);
  expect(await communityAccess(f.db, "c-a-owner", a1)).toEqual({ allowed: true, role: "owner", sources: [] });
});

it("keeps slugs globally unique, well-formed and clear of reserved names", async () => {
  await expect(createCommunity(f.db, "c-b-owner", b, { name: "Copy", slug: "grace-bible-study" })).rejects.toMatchObject({ status: 409 });
  for (const slug of ["Bad Slug", "a", "-dash", "new", "discover", "x".repeat(49)]) await expect(createCommunity(f.db, "c-a-owner", a, { name: "X", slug })).rejects.toThrow();
  await expect(f.admin.query("insert into communities (tenant_id, slug, name) values ($1, 'settings', 'X')", [a])).rejects.toThrow(/community_slug/);
  await expect(createCommunity(f.db, "c-a-owner", a, { name: "X", slug: "ok-slug", extra: true })).rejects.toThrow();
});

it("lets every ministry role list its communities, only owners/admins create, and no other ministry in", async () => {
  expect((await listCommunities(f.db, "c-a-viewer", a)).map((c) => c.slug).sort()).toEqual(["grace-bible-study", "grace-leaders"]);
  await expect(createCommunity(f.db, "c-a-viewer", a, { name: "No", slug: "viewer-made" })).rejects.toMatchObject({ status: 403 });
  await expect(listCommunities(f.db, "c-b-owner", a)).rejects.toMatchObject({ status: 403 });
  expect((await listCommunities(f.db, "c-b-owner", b)).map((c) => c.id)).toEqual([b1]);
  // Without a ministry context, a non-member sees no community rows at all.
  expect(await withUser(f.db, "c-b-owner", (tx) => tx.select().from(communities).where(eq(communities.id, a1)))).toEqual([]);
});

it("updates settings with an optimistic version and refuses paid pricing until commerce exists", async () => {
  const updated = await updateCommunity(f.db, "c-a-owner", a, a2, { version: 1, visibility: "listed", allowOpen: true, tagline: null });
  expect(updated).toMatchObject({ visibility: "listed", allowOpen: true, tagline: null, version: 2 });
  await expect(updateCommunity(f.db, "c-a-owner", a, a2, { version: 1, name: "Stale" })).rejects.toMatchObject({ status: 409 });
  await expect(updateCommunity(f.db, "c-a-owner", a, a2, { version: 2, pricing: "paid" })).rejects.toMatchObject({ status: 409 });
  await expect(updateCommunity(f.db, "c-a-viewer", a, a2, { version: 2, name: "Viewer" })).rejects.toMatchObject({ status: 403 });
  await expect(updateCommunity(f.db, "c-a-owner", a, b1, { version: 1, name: "Other ministry" })).rejects.toMatchObject({ status: 404 });
  expect((await f.admin.query("select metadata from audit_logs where action = 'community.update' and target_id = $1", [a2])).rows[0].metadata).toEqual({ fields: "allowOpen,tagline,visibility" });
});

it("grants access, keeps it while any valid grant remains, and ends it when none does", async () => {
  const first = await grantCommunityAccess(f.db, "c-a-owner", a, a1, { userId: "c-mem1", reason: "Welcome" });
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const second = await grantCommunityAccess(f.db, "c-a-owner", a, a1, { userId: "c-mem1", validUntil: later });
  expect(await communityAccess(f.db, "c-mem1", a1)).toEqual({ allowed: true, role: "member", sources: ["admin_grant", "admin_grant"] });
  // The member path reaches only this community, not the other one in the same ministry or another ministry's.
  expect((await withUser(f.db, "c-mem1", (tx) => tx.select({ id: communities.id }).from(communities))).map((c) => c.id)).toEqual([a1]);
  expect(await communityAccess(f.db, "c-mem1", a2)).toEqual({ allowed: false, role: null, sources: [] });
  await revokeEntitlement(f.db, "c-a-owner", a, first.id, { reason: "Test" });
  expect((await communityAccess(f.db, "c-mem1", a1)).allowed).toBe(true);
  await revokeEntitlement(f.db, "c-a-owner", a, second.id, {});
  expect(await communityAccess(f.db, "c-mem1", a1)).toEqual({ allowed: false, role: "member", sources: [] });
  await expect(revokeEntitlement(f.db, "c-a-owner", a, second.id, {})).rejects.toMatchObject({ status: 404 });
  await expect(revokeEntitlement(f.db, "c-b-owner", b, first.id, {})).rejects.toMatchObject({ status: 404 });
});

it("ignores expired grants", async () => {
  await grantCommunityAccess(f.db, "c-a-owner", a, a1, { userId: "c-mem2" });
  await f.admin.query("update entitlements set valid_from = now() - interval '2 hours', valid_until = now() - interval '1 hour' where user_id = 'c-mem2'");
  expect((await communityAccess(f.db, "c-mem2", a1)).allowed).toBe(false);
});

it("gives banned and pending people nothing, and refuses to re-grant a banned member", async () => {
  await grantCommunityAccess(f.db, "c-a-owner", a, a1, { userId: "c-banned" });
  await f.admin.query("update community_memberships set status = 'banned' where user_id = 'c-banned'");
  await expect(grantCommunityAccess(f.db, "c-a-owner", a, a1, { userId: "c-banned" })).rejects.toMatchObject({ status: 409 });
  expect((await communityAccess(f.db, "c-banned", a1)).allowed).toBe(false);
  expect(await withUser(f.db, "c-banned", (tx) => tx.select().from(communities))).toEqual([]);
  await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, status) values ($1, $2, 'c-pending', 'pending')", [a, a2]);
  expect(await withUser(f.db, "c-pending", (tx) => tx.select().from(communities))).toEqual([]);
  expect((await communityAccess(f.db, "c-pending", a2)).allowed).toBe(false);
});

it("gives the runtime role no delete right on community tables", async () => {
  for (const table of ["communities", "community_memberships", "entitlements"]) {
    await expect(withTenant(f.db, "c-a-owner", a, "communities:manage", (tx) => tx.execute(sql.raw(`delete from ${table}`)))).rejects.toThrow();
  }
  expect((await f.admin.query("select count(*)::int as n from communities")).rows[0].n).toBe(3);
});

it("publishes only a ready community, lists members for staff without contact details, and refuses viewers", async () => {
  const { getCommunity, listCommunityMembers, publishCommunity } = await import("../../src/server/communities");
  const current = await getCommunity(f.db, "c-a-viewer", a, a1);
  await updateCommunity(f.db, "c-a-owner", a, a1, { version: current.version, allowInvite: false });
  const closed = await getCommunity(f.db, "c-a-owner", a, a1);
  await expect(publishCommunity(f.db, "c-a-owner", a, a1, { version: closed.version, published: true })).rejects.toMatchObject({ status: 409 });
  const open = await updateCommunity(f.db, "c-a-owner", a, a1, { version: closed.version, allowOpen: true });
  await expect(publishCommunity(f.db, "c-a-viewer", a, a1, { version: open.version, published: true })).rejects.toMatchObject({ status: 403 });
  const published = await publishCommunity(f.db, "c-a-owner", a, a1, { version: open.version, published: true });
  expect(published).toMatchObject({ status: "published", version: open.version + 1 });
  await expect(publishCommunity(f.db, "c-a-owner", a, a1, { version: open.version, published: false })).rejects.toMatchObject({ status: 409 });
  expect((await publishCommunity(f.db, "c-a-owner", a, a1, { version: published.version, published: false })).status).toBe("draft");
  const members = await listCommunityMembers(f.db, "c-a-viewer", a, a1);
  expect(members[0]).toEqual({ userId: "c-a-owner", name: "c-a-owner", role: "owner", status: "active" });
  expect(Object.keys(members[0])).not.toContain("email");
  await expect(listCommunityMembers(f.db, "c-b-owner", a, a1)).rejects.toMatchObject({ status: 403 });
  expect((await f.admin.query("select action from audit_logs where target_id = $1 and action like 'community.%publish' order by created_at", [a1])).rows.map((r) => r.action)).toEqual(["community.publish", "community.unpublish"]);
});
