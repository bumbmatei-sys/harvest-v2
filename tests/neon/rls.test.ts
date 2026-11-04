import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createPool } from "../../src/db/pool";
import * as schema from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { withTenant } from "../../src/server/tenancy";

// Explicit opt-in only. Synthetic seed rows stay in dev because audit is append-only.
describe.skipIf(process.env.HARVEST_NEON_DEV_VERIFY !== "1")("real harvest-v2 Neon dev RLS", () => {
  const marker = randomUUID();
  const alice = `pr01a-alice-${marker}`; const bob = `pr01a-bob-${marker}`;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof makeDb>;
  let tenantA: string; let tenantB: string;
  function makeDb(connection: ReturnType<typeof createPool>) { return drizzle(connection, { schema }); }
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const metadata = JSON.parse(await readFile("docs/setup/neon-project.json", "utf8"));
    const pooled = new URL(process.env.DATABASE_URL!);
    if (metadata.projectName !== "harvest-v2" || pooled.hostname.replace("-pooler.", ".") !== metadata.devEndpointHost || pooled.username !== "harvest_app") throw new Error("Only harvest-v2 dev with harvest_app may run live tests.");
    pool = createPool(pooled.toString(), 1); db = makeDb(pool);
    await db.insert(schema.users).values([
      { id: alice, name: "PR01a isolation seed A", email: `${alice}@example.test` },
      { id: bob, name: "PR01a isolation seed B", email: `${bob}@example.test` },
    ]);
    tenantA = (await createWorkspace(db, alice, "PR01a RLS verification seed A")).tenantId;
    tenantB = (await createWorkspace(db, bob, "PR01a RLS verification seed B")).tenantId;
  }, 60000);
  afterAll(async () => { await pool?.end(); });
  it("runs as harvest_app without ownership, elevated memberships or RLS bypass", async () => {
    const { rows: [role] } = await pool.query("select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    expect(role).toEqual({ current_user: "harvest_app", rolsuper: false, rolbypassrls: false });
    expect((await pool.query("select 1 from pg_auth_members where member = current_user::regrole")).rows).toEqual([]);
    expect((await pool.query("select 1 from pg_tables where tableowner = current_user and schemaname = 'public'")).rows).toEqual([]);
  });
  it("isolates tenant reads and writes and rejects forged workspace selection", async () => {
    await withTenant(db, alice, tenantA, "workspace:read", async (tx) => {
      expect((await tx.select().from(schema.workspaces)).map((w) => w.tenantId)).toEqual([tenantA]);
      expect(await tx.select().from(schema.workspaces).where(eq(schema.workspaces.tenantId, tenantB))).toEqual([]);
      expect(await tx.update(schema.workspaces).set({ name: "Forbidden" }).where(eq(schema.workspaces.tenantId, tenantB)).returning()).toEqual([]);
    });
    await expect(withTenant(db, alice, tenantB, "workspace:read", async () => "forbidden")).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(db, alice, tenantA, "workspace:read", (tx) => tx.insert(schema.workspaceMembers).values({ tenantId: tenantB, userId: alice, roleId: "owner" }))).rejects.toThrow();
  });
  it.each(["commit", "rollback"])("clears pooled context after %s and returns zero tenant rows", async (ending) => {
    const transaction = withTenant(db, alice, tenantA, "workspace:read", async (tx) => {
      expect((await tx.execute(sql`select current_setting('app.tenant_id', true) as tenant`)).rows[0]).toEqual({ tenant: tenantA });
      if (ending === "rollback") throw new Error("test rollback");
    });
    if (ending === "rollback") await expect(transaction).rejects.toThrow("test rollback"); else await transaction;
    const { rows: [reset] } = await pool.query("select nullif(current_setting('app.tenant_id', true), '') as tenant, nullif(current_setting('app.user_id', true), '') as actor");
    expect(reset).toEqual({ tenant: null, actor: null });
    expect(await db.select().from(schema.workspaces)).toEqual([]);
    expect(await db.select().from(schema.workspaceMembers)).toEqual([]);
    expect(await db.select().from(schema.auditLogs)).toEqual([]);
  });
  it("proves the same physical Neon backend resets after commit and rollback", async () => {
    // PgBouncer may choose a different backend after each transaction. A direct
    // app-role connection makes backend reuse deterministic as well as testing pooled traffic above.
    const direct = new URL(process.env.DATABASE_URL!); direct.hostname = direct.hostname.replace("-pooler.", ".");
    const physical = createPool(direct.toString(), 1); const directDb = makeDb(physical);
    try {
      const { rows: [{ pid }] } = await physical.query("select pg_backend_pid() as pid");
      for (const rollback of [false, true]) {
        const transaction = withTenant(directDb, alice, tenantA, "workspace:read", async (tx) => {
          expect((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]).toEqual({ pid });
          if (rollback) throw new Error("test rollback");
        });
        if (rollback) await expect(transaction).rejects.toThrow("test rollback"); else await transaction;
        const { rows: [reset] } = await physical.query("select pg_backend_pid() as pid, nullif(current_setting('app.tenant_id', true), '') as tenant");
        expect(reset).toEqual({ pid, tenant: null });
        expect(await directDb.select().from(schema.workspaces)).toEqual([]);
      }
    } finally { await physical.end(); }
  });
});
