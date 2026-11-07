import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { crmImportRows, crmImports, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCompany } from "../../src/server/companies";
import { pgCode } from "../../src/server/contacts";
import { commitImport, createImport, getImport, importReport, listImports, previewImport, rollbackImport } from "../../src/server/crm-imports";
import { exportCount, exportRecords } from "../../src/server/crm-export";
import { withTenant } from "../../src/server/tenancy";
import { parseCsvRecords } from "../../src/lib/csv";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
const owners = ["isolation-owner-a", "isolation-owner-b"] as const;
const member = "isolation-member", admin = "isolation-admin";
const workspaces: { tenant: string; owner: string; name: string; importId: string }[] = [];

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values([...owners, member, admin].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  const clientKey = randomUUID();
  for (const [index, owner] of owners.entries()) {
    const name = `Isolation ${index === 0 ? "Alpha" : "Beta"}`;
    const tenant = (await createWorkspace(fixture.db, owner, name)).tenantId;
    // These actors belong to BOTH workspaces: membership alone must not allow
    // an import ID to override the selected workspace.
    for (const [user, role] of [[member, "member"], [admin, "admin"]] as const) {
      await putMember(fixture.db, owner, tenant, `${user}@example.test`, role);
    }
    await createCompany(fixture.db, owner, tenant, { name: `${name} Organization`, domain: "overlap.example.test" });
    const item = await createImport(fixture.db, member, tenant, {
      entity: "person", clientKey, fileName: "overlap.csv",
      csv: `Name,Email\n${name} Person,overlap@example.test\n${name} Private Problem,invalid-email`,
    });
    await previewImport(fixture.db, member, tenant, item.id, { version: item.version });
    await expect(commitImport(fixture.db, member, tenant, item.id)).resolves.toMatchObject({
      status: "completed", remaining: 0, stats: { created: 1, failed: 1 },
    });
    workspaces.push({ tenant, owner, name, importId: item.id });
  }
  expect(workspaces[0].importId).not.toBe(workspaces[1].importId);
});
afterAll(async () => { await fixture?.close(); });

describe("CRM-06 service isolation (real application database connection)", () => {
  it("scopes history, detail and problem downloads even for actors with membership in both workspaces", async () => {
    for (const local of workspaces) {
      const foreign = workspaces.find((workspace) => workspace !== local)!;
      for (const actor of [local.owner, admin, member]) {
        expect((await listImports(fixture.db, actor, local.tenant)).map((item) => item.id)).toEqual([local.importId]);
        const detail = await getImport(fixture.db, actor, local.tenant, local.importId, { outcome: "problem" });
        expect(detail.total).toBe(1);
        expect(detail.rows[0].raw).toContain(`${local.name} Private Problem`);
        const report = await importReport(fixture.db, actor, local.tenant, local.importId);
        expect(report.body).toContain(`${local.name} Private Problem`);
        expect(report.body).not.toContain(foreign.name);
        await expect(getImport(fixture.db, actor, local.tenant, foreign.importId)).rejects.toMatchObject({ status: 404 });
        await expect(importReport(fixture.db, actor, local.tenant, foreign.importId)).rejects.toMatchObject({ status: 404 });
      }
      // Explicitly selecting the foreign workspace also refuses a nonmember.
      await expect(listImports(fixture.db, local.owner, foreign.tenant)).rejects.toMatchObject({ status: 403 });
      await expect(importReport(fixture.db, local.owner, foreign.tenant, foreign.importId)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("exports only selected-workspace people and Organizations with overlapping email/domain identifiers", async () => {
    // Export accepts view parameters, not arbitrary record IDs; use its actual
    // search interface to probe a foreign record and check the count endpoint too.
    for (const local of workspaces) {
      const foreign = workspaces.find((workspace) => workspace !== local)!;
      for (const actor of [local.owner, admin, member]) {
        for (const entity of ["person", "company"] as const) {
          const file = await exportRecords(fixture.db, actor, local.tenant, entity);
          const rows = parseCsvRecords(file.body.replace(/^\uFEFF/, "")) as string[][];
          expect(file.rows).toBe(1);
          expect(rows).toHaveLength(2);
          expect(rows[1][0]).toBe(`${local.name} ${entity === "person" ? "Person" : "Organization"}`);
          expect(file.body).not.toContain(foreign.name);
          expect((await exportCount(fixture.db, actor, local.tenant, entity)).total).toBe(1);
          expect((await exportRecords(fixture.db, actor, local.tenant, entity, { q: foreign.name })).rows).toBe(0);
          expect((await exportCount(fixture.db, actor, local.tenant, entity, { q: foreign.name })).total).toBe(0);
          await expect(exportRecords(fixture.db, local.owner, foreign.tenant, entity)).rejects.toMatchObject({ status: 403 });
          await expect(exportCount(fixture.db, local.owner, foreign.tenant, entity)).rejects.toMatchObject({ status: 403 });
        }
      }
    }
  });

  it("refuses foreign completed-import rollback IDs for creators, admins and owners without changing either import", async () => {
    for (const local of workspaces) {
      const foreign = workspaces.find((workspace) => workspace !== local)!;
      for (const actor of [local.owner, admin, member]) {
        await expect(rollbackImport(fixture.db, actor, local.tenant, foreign.importId)).rejects.toMatchObject({ status: 404 });
      }
      await expect(rollbackImport(fixture.db, local.owner, foreign.tenant, foreign.importId)).rejects.toMatchObject({ status: 403 });
    }
    for (const workspace of workspaces) {
      expect(await getImport(fixture.db, member, workspace.tenant, workspace.importId)).toMatchObject({ status: "completed" });
      expect((await exportCount(fixture.db, member, workspace.tenant, "person")).total).toBe(1);
    }
    // Own-import rollback and denial on another creator's import already have
    // positive/negative permission coverage in crm-imports.test.ts, "rollback".
  });
});

describe("CRM-06 RLS evidence (unfiltered SQL, separate from service assertions)", () => {
  it("uses harvest_app without superuser/BYPASSRLS and enforces FORCE RLS on imports and rows", async () => {
    // No privileged connection is used to establish application-role proof.
    const role = await fixture.pool.query("select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    expect(role.rows).toEqual([{ name: "harvest_app", rolsuper: false, rolbypassrls: false }]);
    const tables = await fixture.pool.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where oid in ('public.crm_imports'::regclass, 'public.crm_import_rows'::regclass) order by relname");
    expect(tables.rows).toEqual(["crm_import_rows", "crm_imports"].map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
    expect(await fixture.db.select().from(crmImports)).toEqual([]);
    expect(await fixture.db.select().from(crmImportRows)).toEqual([]);
    for (const local of workspaces) {
      await withTenant(fixture.db, member, local.tenant, "crm:import", async (tx) => {
        expect((await tx.select().from(crmImports)).map((item) => item.id)).toEqual([local.importId]);
        const rows = await tx.select().from(crmImportRows);
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.tenantId === local.tenant && row.importId === local.importId)).toBe(true);
        const role = await tx.execute(sql`select current_user as name`);
        expect(role.rows).toEqual([{ name: "harvest_app" }]);
      });
    }
  });
});

// These tests mutate shared state and rely on source order (vitest runs a file's tests in order, no shuffle).
// The role-gate test restores the state it changes, so the later rollback tests still start from 1 person per workspace.
describe("CRM-06 authorized rollback across two workspaces (runs last: it changes data)", () => {
  it("enforces the rollback role gate: a member of both workspaces who did not create an import is refused, an admin is allowed", async () => {
    for (const local of workspaces) {
      // Created by the workspace owner. `member` and `admin` belong to both workspaces, but only `admin` may roll back someone else's import.
      const item = await createImport(fixture.db, local.owner, local.tenant, {
        entity: "person", clientKey: randomUUID(), fileName: "role-gate.csv", csv: `Name,Email\n${local.name} Role Gate,role-gate-${local.tenant}@example.test`,
      });
      await previewImport(fixture.db, local.owner, local.tenant, item.id, { version: item.version });
      await expect(commitImport(fixture.db, local.owner, local.tenant, item.id)).resolves.toMatchObject({ status: "completed", stats: { created: 1 } });
      expect((await exportCount(fixture.db, local.owner, local.tenant, "person")).total).toBe(2);
      await expect(rollbackImport(fixture.db, member, local.tenant, item.id)).rejects.toMatchObject({ status: 403 });
      expect(await getImport(fixture.db, member, local.tenant, item.id)).toMatchObject({ status: "completed" });
      expect((await exportCount(fixture.db, local.owner, local.tenant, "person")).total).toBe(2);
      expect(await rollbackImport(fixture.db, admin, local.tenant, item.id)).toMatchObject({ status: "rolled_back", result: { removed: 1, reverted: 0, kept: 0 } });
      expect((await exportCount(fixture.db, local.owner, local.tenant, "person")).total).toBe(1);
    }
  });

  it("refuses a mismatched tenant argument and a foreign import ID at the SQL definer itself", async () => {
    const [a, b] = workspaces;
    // The session is workspace A. Calling the definer directly (bypassing the service) must still
    // be refused when it names workspace B, and must find nothing for B's import ID inside A.
    const call = (tenantArg: string, importId: string) => withTenant(fixture.db, member, a.tenant, "crm:import", async (tx) => {
      const rows = await tx.execute(sql`select public.rollback_crm_import(${tenantArg}::uuid, ${importId}::uuid) as result`);
      return rows.rows[0]?.result ?? null;
    });
    await expect(call(b.tenant, b.importId).catch((error) => pgCode(error))).resolves.toBe("42501");
    await expect(call(b.tenant, a.importId).catch((error) => pgCode(error))).resolves.toBe("42501");
    await expect(call(a.tenant, b.importId)).resolves.toBeNull();
    for (const workspace of workspaces) {
      expect(await getImport(fixture.db, member, workspace.tenant, workspace.importId)).toMatchObject({ status: "completed" });
      expect((await exportCount(fixture.db, member, workspace.tenant, "person")).total).toBe(1);
    }
  });

  it("lets an admin roll back another creator's import and the creator roll back their own, each leaving the other workspace untouched", async () => {
    const [a, b] = workspaces;
    const people = async (workspace: typeof a) => (await exportCount(fixture.db, workspace.owner, workspace.tenant, "person")).total;
    const organizations = async (workspace: typeof a) => (await exportCount(fixture.db, workspace.owner, workspace.tenant, "company")).total;
    // `admin` belongs to both workspaces but did not create either import; owners and admins may roll back any import.
    expect(await rollbackImport(fixture.db, admin, b.tenant, b.importId)).toMatchObject({ status: "rolled_back", result: { removed: 1, reverted: 0, kept: 0 } });
    expect([await people(a), await people(b)]).toEqual([1, 0]);
    expect(await getImport(fixture.db, member, a.tenant, a.importId)).toMatchObject({ status: "completed" });
    // The creator rolls back their own import; the already rolled-back workspace B is not touched again.
    expect(await rollbackImport(fixture.db, member, a.tenant, a.importId)).toMatchObject({ status: "rolled_back", result: { removed: 1, reverted: 0, kept: 0 } });
    expect([await people(a), await people(b)]).toEqual([0, 0]);
    // Organizations were not part of either import and stay in their own workspace.
    expect([await organizations(a), await organizations(b)]).toEqual([1, 1]);
    for (const workspace of workspaces) {
      expect(await getImport(fixture.db, member, workspace.tenant, workspace.importId)).toMatchObject({ status: "rolled_back" });
      // A rollback is final, and the foreign import ID stays unreachable.
      await expect(rollbackImport(fixture.db, workspace.owner, workspace.tenant, workspace.importId)).rejects.toMatchObject({ status: 409 });
      const foreign = workspaces.find((other) => other !== workspace)!;
      await expect(rollbackImport(fixture.db, workspace.owner, workspace.tenant, foreign.importId)).rejects.toMatchObject({ status: 404 });
      // Each rollback event carries only its own workspace. This one read deliberately uses the privileged
      // pool to inspect the outbox; it is not part of the application-role isolation proof above.
      const events = await fixture.admin.query("select payload from outbox_events where idempotency_key = $1", [`crm:import:${workspace.importId}:rolled_back`]);
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].payload).toMatchObject({ tenantId: workspace.tenant, importId: workspace.importId, removed: 1 });
    }
  });
});
