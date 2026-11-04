import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { auditLogs, users, workspaceMembers, workspaces } from "../../src/db/schema";
import { createWorkspace, listWorkspaces, putMember } from "../../src/server/workspaces";
import { withTenant } from "../../src/server/tenancy";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string; let tenantB: string;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values([
    { id: "alice", name: "Alice", email: "alice@example.test" },
    { id: "bob", name: "Bob", email: "bob@example.test" },
    { id: "viewer", name: "Viewer", email: "viewer@example.test" },
    { id: "admin", name: "Admin", email: "admin@example.test" },
  ]);
  tenantA = (await createWorkspace(fixture.db, "alice", "Workspace A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "bob", "Workspace B")).tenantId;
});
afterAll(async () => { await fixture?.close(); });
describe("PostgreSQL tenant isolation with the real application role", () => {
  it("uses a non-owner role without superuser or BYPASSRLS", async () => {
    const { rows: [role] } = await fixture.pool.query("select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    expect(role).toEqual({ current_user: "harvest_app", rolsuper: false, rolbypassrls: false });
    const { rows } = await fixture.pool.query("select tablename from pg_tables where tableowner = current_user and schemaname = 'public'");
    expect(rows).toEqual([]);
  });
  it("denies all tenant rows without context", async () => {
    expect(await fixture.db.select().from(workspaces)).toEqual([]);
    expect(await fixture.db.select().from(workspaceMembers)).toEqual([]);
    expect(await fixture.db.select().from(auditLogs)).toEqual([]);
  });
  it("filters unqualified reads, cross-tenant reads and writes", async () => {
    await withTenant(fixture.db, "alice", tenantA, "workspace:read", async (tx) => {
      expect((await tx.select().from(workspaces)).map((w) => w.tenantId)).toEqual([tenantA]);
      expect(await tx.select().from(workspaces).where(eq(workspaces.tenantId, tenantB))).toEqual([]);
      expect(await tx.update(workspaces).set({ name: "Forbidden" }).where(eq(workspaces.tenantId, tenantB)).returning()).toEqual([]);
      expect(await tx.delete(workspaceMembers).where(eq(workspaceMembers.tenantId, tenantB)).returning()).toEqual([]);
      expect((await tx.select().from(auditLogs)).every((a) => a.tenantId === tenantA)).toBe(true);
    });
    await expect(withTenant(fixture.db, "alice", tenantA, "workspace:read", (tx) => tx.insert(workspaceMembers).values({ tenantId: tenantB, userId: "alice", roleId: "owner" }))).rejects.toThrow();
  });
  it("rejects a client workspace hint without verified membership", async () => {
    await expect(withTenant(fixture.db, "alice", tenantB, "workspace:read", async () => "leaked")).rejects.toMatchObject({ status: 403 });
    expect((await listWorkspaces(fixture.db, "alice")).map((w) => w.name)).toEqual(["Workspace A"]);
    await expect(createWorkspace(fixture.db, "", "Anonymous")).rejects.toMatchObject({ status: 401 });
  });
  it.each(["commit", "rollback"])("resets user and tenant on the same pooled connection after %s", async (ending) => {
    const { rows: [{ pid: before }] } = await fixture.pool.query("select pg_backend_pid() as pid");
    const transaction = withTenant(fixture.db, "alice", tenantA, "workspace:read", async (tx) => {
      const result = await tx.execute(sql`select pg_backend_pid() as pid, current_setting('app.tenant_id', true) as tenant`);
      expect(result.rows[0]).toMatchObject({ pid: before, tenant: tenantA });
      if (ending === "rollback") throw new Error("intentional rollback");
    });
    if (ending === "rollback") await expect(transaction).rejects.toThrow("intentional rollback"); else await transaction;
    const { rows: [reset] } = await fixture.pool.query("select pg_backend_pid() as pid, nullif(current_setting('app.tenant_id', true), '') as tenant, nullif(current_setting('app.user_id', true), '') as actor");
    expect(reset).toEqual({ pid: before, tenant: null, actor: null });
    expect(await fixture.db.select().from(workspaces)).toEqual([]);
    expect(await fixture.db.select().from(workspaceMembers)).toEqual([]);
    expect(await fixture.db.select().from(auditLogs)).toEqual([]);
    await withTenant(fixture.db, "bob", tenantB, "workspace:read", async (tx) => {
      expect((await tx.select().from(workspaces)).map((w) => w.tenantId)).toEqual([tenantB]);
    });
  });
  it("gates and audits member/role changes and preserves the last owner", async () => {
    await putMember(fixture.db, "alice", tenantA, "viewer@example.test", "viewer");
    await expect(putMember(fixture.db, "viewer", tenantA, "bob@example.test", "admin")).rejects.toMatchObject({ status: 403 });
    await putMember(fixture.db, "alice", tenantA, "admin@example.test", "admin");
    await expect(putMember(fixture.db, "admin", tenantA, "alice@example.test", "member")).rejects.toMatchObject({ status: 403 });
    await expect(putMember(fixture.db, "alice", tenantA, "alice@example.test", "admin")).rejects.toMatchObject({ status: 409 });
    await putMember(fixture.db, "alice", tenantA, "viewer@example.test", "member");
    await withTenant(fixture.db, "alice", tenantA, "workspace:read", async (tx) => {
      expect((await tx.select().from(auditLogs)).map((a) => a.action)).toEqual(["workspace.create", "member.add", "member.add", "member.role_change"]);
    });
  });
  it("scopes memberships to the selected tenant even for users in multiple workspaces", async () => {
    await putMember(fixture.db, "bob", tenantB, "admin@example.test", "member");
    expect((await listWorkspaces(fixture.db, "admin")).length).toBe(2);
    await withTenant(fixture.db, "admin", tenantA, "workspace:read", async (tx) => {
      const members = await tx.select().from(workspaceMembers);
      expect(members.length).toBeGreaterThan(0);
      expect(members.every((member) => member.tenantId === tenantA)).toBe(true);
    });
  });
  it("rejects audit edits/deletion/truncation even by the migration owner", async () => {
    await expect(fixture.pool.query("update audit_logs set action = 'tampered'")).rejects.toThrow();
    await expect(fixture.pool.query("delete from audit_logs")).rejects.toThrow();
    await expect(fixture.pool.query("truncate audit_logs")).rejects.toThrow();
    await expect(fixture.admin.query("delete from audit_logs")).rejects.toThrow("append-only");
  });
  it("rolls back workspace/member writes if audit insertion fails", async () => {
    await fixture.admin.query("create function test_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end $$");
    await fixture.admin.query("create trigger test_audit_failure before insert on audit_logs for each row execute function test_reject_audit()");
    try {
      await expect(createWorkspace(fixture.db, "alice", "Must roll back")).rejects.toThrow();
      expect((await listWorkspaces(fixture.db, "alice")).map((w) => w.name)).toEqual(["Workspace A"]);
    } finally { await fixture.admin.query("drop trigger test_audit_failure on audit_logs"); }
  });
});
