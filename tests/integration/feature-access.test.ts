import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { auditLogs, users, workspaceMembers } from "../../src/db/schema";
import { and, eq } from "drizzle-orm";
import { createWorkspace, getWorkspace, putMember } from "../../src/server/workspaces";
import { directAddAllowed, acceptInvitation, changeMemberAccess, inviteMember, invitationTestSink, listInvitations, listMemberAccess, revokeInvitation } from "../../src/server/access";
import { withTenant } from "../../src/server/tenancy";
import { AccessError } from "../../src/server/permissions";

// Per-feature access (founder decision, 25 Nov). Runs under a restricted (non-superuser) migration owner, so the definer policies are exercised for real.
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string;
const ids = ["fa-owner", "fa-admin", "fa-member", "fa-viewer", "fa-collab", "fa-guest", "fa-new", "fa-other"];
const rejects = async (p: Promise<unknown>, status?: number) => { const e = await p.then(() => null, (x) => x); expect(e).not.toBeNull(); if (status) expect((e as AccessError).status).toBe(status); };
const probe = (user: string, query: ReturnType<typeof sql>) => withTenant(f.db, user, tenant, "workspace:read", async (tx) => (await tx.execute(query)).rows as Record<string, unknown>[]);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(ids.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "fa-owner", "Grace Fellowship", "church")).tenantId;
  other = (await createWorkspace(f.db, "fa-other", "Elsewhere", "church")).tenantId;
  await putMember(f.db, "fa-owner", tenant, "fa-admin@example.test", "admin");
  await putMember(f.db, "fa-owner", tenant, "fa-member@example.test", "member");
  await putMember(f.db, "fa-owner", tenant, "fa-viewer@example.test", "viewer");
  await putMember(f.db, "fa-owner", tenant, "fa-collab@example.test", "viewer");
  await putMember(f.db, "fa-owner", tenant, "fa-guest@example.test", "viewer");
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-collab", role: "collaborator", grants: { social: "manage", crm: "view" } });
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-guest", role: "guest" });
}, 120000);
afterAll(async () => { await f?.close(); });

it("a collaborator holds exactly the areas granted; the database agrees with the code", async () => {
  const ws = await getWorkspace(f.db, "fa-collab", tenant);
  expect(ws.role).toBe("collaborator;crm=view;social=manage");
  await withTenant(f.db, "fa-collab", tenant, "social:connect", async (_tx, _t, role) => { expect(role).toBe("admin"); });
  await withTenant(f.db, "fa-collab", tenant, "contacts:read", async (_tx, _t, role) => { expect(role).toBe("viewer"); });
  await rejects(withTenant(f.db, "fa-collab", tenant, "contacts:write", async () => 1), 403);
  await rejects(withTenant(f.db, "fa-collab", tenant, "newsletter:campaigns", async () => 1), 403);
  await rejects(withTenant(f.db, "fa-collab", tenant, "members:write", async () => 1), 403);
  const rows = await probe("fa-collab", sql`select public.ads_can(${tenant}::uuid) as ads, public.office_can(${tenant}::uuid, 'fa-collab', 'office:mail') as office, public.catalog_staff(${tenant}::uuid) as catalog, public.community_stats_can(${tenant}::uuid) as stats`);
  expect(rows[0]).toEqual({ ads: true, office: false, catalog: false, stats: false });
});
it("legacy roles are unchanged in the database helpers", async () => {
  for (const [user, expected] of [["fa-owner", true], ["fa-admin", true], ["fa-member", false], ["fa-viewer", false], ["fa-guest", false]] as const) {
    expect((await probe(user, sql`select public.ads_can(${tenant}::uuid) as v`))[0].v, user).toBe(expected);
  }
});
it("policies follow grants: newsletter rows need the newsletter area", async () => {
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-collab", role: "collaborator", grants: { newsletter: "manage" } });
  await withTenant(f.db, "fa-collab", tenant, "newsletter:manage", async (tx) => { await tx.execute(sql`insert into newsletter_audiences (tenant_id, name, created_by) values (${tenant}::uuid, 'News', 'fa-collab')`); });
  expect((await probe("fa-collab", sql`select count(*)::int as n from newsletter_audiences`))[0].n).toBe(1);
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-collab", role: "collaborator", grants: { crm: "manage" } });
  expect((await probe("fa-collab", sql`select count(*)::int as n from newsletter_audiences`))[0].n).toBe(0);
  await rejects(withTenant(f.db, "fa-collab", tenant, "workspace:read", (tx) => tx.execute(sql`insert into newsletter_audiences (tenant_id, name, created_by) values (${tenant}::uuid, 'No', 'fa-collab')`)));
  expect((await probe("fa-member", sql`select count(*)::int as n from newsletter_audiences`))[0].n).toBe(1);
});
it("a guest holds no area and reads no account data", async () => {
  await rejects(withTenant(f.db, "fa-guest", tenant, "contacts:read", async () => 1), 403);
  expect((await getWorkspace(f.db, "fa-guest", tenant)).role).toBe("guest");
  expect((await probe("fa-guest", sql`select count(*)::int as n from newsletter_audiences`))[0].n).toBe(0);
});
it("only an owner grants admin; an admin cannot touch an admin or owner; nobody changes their own access", async () => {
  await rejects(changeMemberAccess(f.db, "fa-admin", tenant, { userId: "fa-member", role: "admin" }), 403);
  await rejects(changeMemberAccess(f.db, "fa-admin", tenant, { userId: "fa-owner", role: "member" }), 403);
  await rejects(changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-owner", role: "member" }), 403);
  await rejects(changeMemberAccess(f.db, "fa-collab", tenant, { userId: "fa-member", role: "viewer" }), 403);
  await rejects(putMember(f.db, "fa-admin", tenant, "fa-member@example.test", "admin"), 403);
  expect((await changeMemberAccess(f.db, "fa-admin", tenant, { userId: "fa-member", role: "collaborator", grants: { campaigns: "view" } })).areas).toBe("campaigns:view");
  expect((await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-member", role: "member" })).role).toBe("member");
  await rejects(changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-member", role: "member", grants: { crm: "view" } }), 400);
  await rejects((async () => changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-member", role: "collaborator", grants: { nonsense: "manage" } as never }))());
});
it("the database refuses the application role what the server refuses", async () => {
  await rejects(withTenant(f.db, "fa-admin", tenant, "workspace:read", (tx) => tx.update(workspaceMembers).set({ roleId: "admin" }).where(and(eq(workspaceMembers.tenantId, tenant), eq(workspaceMembers.userId, "fa-member")))));
  await rejects(withTenant(f.db, "fa-admin", tenant, "workspace:read", (tx) => tx.delete(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenant), eq(workspaceMembers.userId, "fa-owner")))));
  await rejects(withTenant(f.db, "fa-owner", tenant, "workspace:read", (tx) => tx.update(workspaceMembers).set({ roleId: "member" }).where(and(eq(workspaceMembers.tenantId, tenant), eq(workspaceMembers.userId, "fa-owner")))));
  await rejects(withTenant(f.db, "fa-owner", tenant, "workspace:read", (tx) => tx.execute(sql`insert into workspace_member_access (tenant_id, user_id, area, level, granted_by) values (${tenant}::uuid, 'fa-member', 'crm', 'manage', 'fa-owner')`)));
});
it("ownership transfer: promote, then the new owner may demote the old one", async () => {
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-admin", role: "owner" });
  expect((await changeMemberAccess(f.db, "fa-admin", tenant, { userId: "fa-owner", role: "admin" })).role).toBe("admin");
  await rejects(changeMemberAccess(f.db, "fa-admin", tenant, { userId: "fa-admin", role: "member" }), 403);
  await changeMemberAccess(f.db, "fa-admin", tenant, { userId: "fa-owner", role: "owner" });
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-admin", role: "admin" });
});
it("invitations are accepted by the invitee and carry role and areas", async () => {
  const made = await inviteMember(f.db, "fa-admin", tenant, { email: "FA-New@example.test", role: "collaborator", grants: { social: "manage" } });
  expect(made.delivered).toBe(false);
  const token = invitationTestSink.at(-1)!.token;
  expect((await f.admin.query("select count(*)::int n from workspace_members where tenant_id=$1 and user_id='fa-new'", [tenant])).rows[0].n).toBe(0);
  await rejects(acceptInvitation(f.db, "fa-member", token), 404);
  await rejects(acceptInvitation(f.db, "fa-new", "x".repeat(40)), 404);
  await rejects(inviteMember(f.db, "fa-member", tenant, { email: "x@example.test", role: "member" }), 403);
  await rejects(inviteMember(f.db, "fa-admin", tenant, { email: "x@example.test", role: "admin" }), 403);
  const accepted = await acceptInvitation(f.db, "fa-new", token);
  expect(accepted).toEqual({ tenantId: tenant, role: "collaborator", joined: true });
  expect((await getWorkspace(f.db, "fa-new", tenant)).role).toBe("collaborator;social=manage");
  expect((await acceptInvitation(f.db, "fa-new", token)).joined).toBe(false);
  expect((await listInvitations(f.db, "fa-owner", tenant)).find((i) => i.id === made.id)?.status).toBe("accepted");
  expect((await listMemberAccess(f.db, "fa-owner", tenant)).find((m) => m.userId === "fa-new")?.grants).toEqual({ social: "manage" });
});
it("expired, withdrawn and lapsed invitations cannot be accepted; the owner alone invites an admin", async () => {
  const a = await inviteMember(f.db, "fa-owner", tenant, { email: "fa-viewer@example.test", role: "admin" });
  const tokenA = invitationTestSink.at(-1)!.token;
  await revokeInvitation(f.db, "fa-owner", tenant, a.id);
  await rejects(acceptInvitation(f.db, "fa-viewer", tokenA), 409);
  await inviteMember(f.db, "fa-admin", tenant, { email: "fa-viewer@example.test", role: "member" });
  const tokenB = invitationTestSink.at(-1)!.token;
  await f.admin.query("update workspace_invitations set expires_at = created_at + interval '14 days'"); // keep the check; age it via created_at below
  await f.admin.query("alter table workspace_invitations disable trigger all");
  await f.admin.query("update workspace_invitations set created_at = created_at - interval '15 days', expires_at = expires_at - interval '15 days' where status='pending'");
  await rejects(acceptInvitation(f.db, "fa-viewer", tokenB), 409);
  await inviteMember(f.db, "fa-admin", tenant, { email: "fa-viewer@example.test", role: "viewer" });
  const tokenC = invitationTestSink.at(-1)!.token;
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-admin", role: "member" }); // the inviter loses the right to grant
  await rejects(acceptInvitation(f.db, "fa-viewer", tokenC), 409);
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-admin", role: "admin" });
});
it("an admin created with 'manages admins' acts like an owner for admins, never for the owner", async () => {
  expect(directAddAllowed()).toBe(false);
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-member", role: "admin", canManageAdmins: true });
  const flag = async (u: string) => (await f.admin.query("select can_manage_admins f from workspace_members where tenant_id=$1 and user_id=$2", [tenant, u])).rows[0].f;
  expect(await flag("fa-member")).toBe(true); expect(await flag("fa-admin")).toBe(false);
  // the plain admin still cannot change admins or give the permission
  await rejects(changeMemberAccess(f.db, "fa-admin", tenant, { userId: "fa-viewer", role: "admin", canManageAdmins: true }), 403);
  await rejects(inviteMember(f.db, "fa-admin", tenant, { email: "fa-viewer@example.test", role: "admin" }), 403);
  // the flagged admin can grant, change and remove admins, and give the permission
  expect((await changeMemberAccess(f.db, "fa-member", tenant, { userId: "fa-viewer", role: "admin", canManageAdmins: true })).role).toBe("admin");
  expect(await flag("fa-viewer")).toBe(true);
  await changeMemberAccess(f.db, "fa-member", tenant, { userId: "fa-admin", role: "viewer" });
  await changeMemberAccess(f.db, "fa-member", tenant, { userId: "fa-viewer", role: "viewer" });
  expect(await flag("fa-viewer")).toBe(false);
  // never the owner, and the permission only goes with the admin role
  await rejects(changeMemberAccess(f.db, "fa-member", tenant, { userId: "fa-owner", role: "member" }), 403);
  await rejects(changeMemberAccess(f.db, "fa-member", tenant, { userId: "fa-owner", role: "admin" }), 403);
  await rejects(changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-viewer", role: "member", canManageAdmins: true }), 400);
  await rejects(withTenant(f.db, "fa-member", tenant, "workspace:read", (tx) => tx.update(workspaceMembers).set({ roleId: "owner" }).where(and(eq(workspaceMembers.tenantId, tenant), eq(workspaceMembers.userId, "fa-viewer")))));
  // a flagged admin invites an admin; the invitation lapses once the inviter loses the permission
  await inviteMember(f.db, "fa-member", tenant, { email: "fa-viewer@example.test", role: "admin" });
  const token = invitationTestSink.at(-1)!.token;
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-member", role: "admin" });
  await rejects(acceptInvitation(f.db, "fa-viewer", token), 409);
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-member", role: "member" });
  await changeMemberAccess(f.db, "fa-owner", tenant, { userId: "fa-admin", role: "admin" });
});
it("every grant change is audited with area names only", async () => {
  const rows = await f.admin.query("select action, metadata from audit_logs where tenant_id=$1 and action in ('member.access_change','invitation.create','invitation.accept','invitation.revoke')", [tenant]);
  const actions = new Set(rows.rows.map((r) => r.action));
  for (const a of ["member.access_change", "invitation.create", "invitation.accept", "invitation.revoke"]) expect(actions.has(a)).toBe(true);
  expect(JSON.stringify(rows.rows)).not.toContain("example.test");
  expect(f.db).toBeDefined(); expect(auditLogs).toBeDefined();
});
it("a collaborator of another account reads nothing here", async () => {
  await rejects(withTenant(f.db, "fa-other", tenant, "workspace:read", async () => 1), 403);
  expect(other).toBeTruthy();
});
