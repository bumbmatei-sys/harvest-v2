import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as schema from "../../src/db/schema";
import { decideToolApproval } from "../../src/server/ai/crm-tools";
import { getCrmImportDiagnostics } from "../../src/server/crm-diagnostics";
import { createImport } from "../../src/server/crm-imports";
import { pgCode } from "../../src/server/contacts";
import { AccessError } from "../../src/server/permissions";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "leftovers-owner", admin = "leftovers-admin", member = "leftovers-member",
  viewer = "leftovers-viewer", outside = "leftovers-outside";
const legacyApprovalId = randomUUID();
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, emptyTenant: string, importId: string;

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => fixture.db }));
vi.mock("@/server/http", async (original) => ({
  ...await original<typeof import("../../src/server/http")>(),
  verifiedUser: async (request: Request) => {
    const user = request.headers.get("x-test-user");
    if (!user) throw new AccessError(401, "Sign in to continue.");
    return user;
  },
}));

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true, async beforeCrmLeftoversMigration(pool) {
    const db = drizzle(pool, { schema });
    await db.insert(schema.users).values([owner, admin, member, viewer, outside].map((id) => ({ id, name: id, email: `${id}@example.test` })));
    tenant = (await createWorkspace(db, owner, "CRM leftovers test")).tenantId;
    emptyTenant = (await createWorkspace(db, outside, "CRM diagnostics other ministry")).tenantId;
    await putMember(db, owner, tenant, `${admin}@example.test`, "admin");
    await putMember(db, owner, tenant, `${member}@example.test`, "member");
    await putMember(db, owner, tenant, `${viewer}@example.test`, "viewer");
    await putMember(db, outside, emptyTenant, `${admin}@example.test`, "admin");
    importId = (await createImport(db, member, tenant, {
      entity: "person", clientKey: randomUUID(), fileName: "private-name.csv", csv: "Name,Email\nPrivate person,private@example.test",
    })).id;

    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${owner}, true)`);
      await tx.execute(sql`
        insert into ai_tool_approvals (tenant_id, id, tool, args_hash, requested_by, expires_at)
        values (${tenant}, ${legacyApprovalId}, 'crm_create_task', ${"0".repeat(64)}, ${owner}, now() + interval '1 hour')
      `);
      await tx.insert(schema.auditLogs).values({
        tenantId: tenant, actorId: owner, action: "ai.tool_approval_request", targetId: legacyApprovalId,
        metadata: { tool: "crm_create_task" },
      });
    });
  } });
});

afterAll(async () => { await fixture?.close(); });

it("preserves historical approvals and audit references across the restricted-owner upgrade", async () => {
  await expect(decideToolApproval(fixture.db, owner, tenant, legacyApprovalId, "approve"))
    .rejects.toMatchObject({ status: 409, details: { reason: "approval_expired" } });
  const { rows } = await fixture.admin.query(`
    select a.status, a.expires_at - a.created_at = interval '1 hour' as historical_ttl, l.action
    from ai_tool_approvals a join audit_logs l on (l.tenant_id, l.target_id) = (a.tenant_id, a.id::text)
    where a.tenant_id = $1 and a.id = $2
  `, [tenant, legacyApprovalId]);
  expect(rows).toEqual([{ status: "pending", historical_ttl: true, action: "ai.tool_approval_request" }]);
});

it("returns a fixed, metadata-only diagnostic projection to owners and admins", async () => {
  for (const user of [owner, admin]) {
    expect(await getCrmImportDiagnostics(fixture.db, user, tenant)).toEqual({ imports: [{
      id: importId, entity: "person", status: "draft", createdAt: expect.stringMatching(/T.*Z$/), updatedAt: expect.stringMatching(/T.*Z$/),
      completedAt: null, rolledBackAt: null,
    }] });
  }
  expect(await getCrmImportDiagnostics(fixture.db, admin, emptyTenant)).toEqual({ imports: [] });
  for (const user of [member, viewer, outside]) {
    await expect(getCrmImportDiagnostics(fixture.db, user, tenant)).rejects.toMatchObject({ status: 403 });
  }
});

it("rejects SQL callers with missing context, the wrong ministry, an insufficient role, or the worker login", async () => {
  const read = (userId: string, scope: string, target: string) => fixture.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true), set_config('app.tenant_id', ${scope}, true)`);
    return tx.execute(sql`select * from public.crm_import_diagnostics(${target}::uuid)`);
  });
  for (const [user, scope, target] of [[member, tenant, tenant], [viewer, tenant, tenant], [outside, tenant, tenant],
    [admin, "", tenant], ["", tenant, tenant], [admin, emptyTenant, tenant]]) {
    await expect(read(user, scope, target).catch(pgCode)).resolves.toBe("42501");
  }
  await expect(fixture.workerPool.query("select * from public.crm_import_diagnostics($1)", [tenant]))
    .rejects.toMatchObject({ code: "42501" });
});

it("serves only the diagnostic projection through the verified, non-cacheable GET", async () => {
  const { GET } = await import("../../src/app/api/workspaces/[tenantId]/crm/diagnostics/route");
  const request = (userId?: string) => GET(new Request("https://example.test/api", {
    headers: userId ? { "x-test-user": userId } : undefined,
  }), { params: Promise.resolve({ tenantId: tenant }) });
  const response = await request(admin);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ imports: [{
    id: importId, entity: "person", status: "draft", createdAt: expect.stringMatching(/T.*Z$/), updatedAt: expect.stringMatching(/T.*Z$/),
    completedAt: null, rolledBackAt: null,
  }] });
  expect((await request(member)).status).toBe(403);
  expect((await request()).status).toBe(401);
});
