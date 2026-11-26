import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { isolationCases, seedIsolation, type IsolationFixture, type IsolationRuntime } from "../cf02/isolation";
import { isolationRuntime } from "../cf02/runtime";
import { withDb, type DatabaseEnvironment, type Transaction } from "../../src/db/request";

vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase({ migrationOwner: true }); });
afterAll(async () => { await fixture?.close(); });

describe.each(["node", "workers"] as const)("%s request scopes", (runtime) => {
  let app: DatabaseEnvironment;
  let worker: DatabaseEnvironment;
  let appPool: Pool | undefined;
  let workerPool: Pool | undefined;
  let probe: IsolationRuntime;
  let data: IsolationFixture;
  beforeAll(async () => {
    if (runtime === "node") {
      appPool = new Pool({ connectionString: fixture.appURL, max: 4 });
      workerPool = new Pool({ connectionString: fixture.workerURL, max: 2 });
      app = { runtime, role: "app", pool: appPool };
      worker = { runtime, role: "worker", pool: workerPool };
    } else {
      app = { runtime, role: "app", APP_HYPERDRIVE: { connectionString: fixture.appURL } };
      worker = { runtime, role: "worker", WORKER_HYPERDRIVE: { connectionString: fixture.workerURL } };
    }
    probe = isolationRuntime(app, worker, randomBytes(48).toString("base64url"));
    data = await seedIsolation(probe);
  });
  afterAll(async () => { await Promise.all([appPool?.end(), workerPool?.end()]); });

  for (const [name, check] of Object.entries(isolationCases)) {
    it(name, async () => {
      await check(probe, data);
      if (appPool && workerPool) {
        for (const pool of [appPool, workerPool]) {
          expect(pool.waitingCount).toBe(0);
          expect(pool.idleCount).toBe(pool.totalCount);
        }
      } else {
        await expect.poll(async () => (await fixture.admin.query(`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and usename in ('harvest_app', 'harvest_worker')`)).rows[0].count,
        { timeout: 3_000 }).toBe(0);
      }
    });
  }

  it("reuses Node physical connections and closes ephemeral connections and escaped handles", async () => {
    const pid = async (db: Parameters<Parameters<typeof withDb>[1]>[0]) =>
      (await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    let escaped: Transaction | undefined;
    const first = await withDb(app, async (db) => {
      await db.transaction(async (tx) => {
        escaped = tx;
        await expect(db.execute(sql`select 1`)).rejects.toMatchObject({ cause: { message: "DATABASE_USE_TRANSACTION_HANDLE" } });
      });
      await expect(escaped!.execute(sql`select 1`)).rejects.toMatchObject({ cause: { message: "DATABASE_TRANSACTION_ENDED" } });
      return { db, pid: await pid(db) };
    });
    const second = await withDb(app, pid);
    if (runtime === "node") expect(second).toBe(first.pid);
    else expect(second).not.toBe(first.pid);
    await expect(pid(first.db)).rejects.toMatchObject({ cause: { message: "DATABASE_REQUEST_ENDED" } });
    await expect(escaped!.execute(sql`select 1`)).rejects.toMatchObject({ cause: { message: "DATABASE_REQUEST_ENDED" } });
  });

  it("rejects swapped and owner credentials before handing out a database", async () => {
    const use = vi.fn(async () => undefined);
    await expect(withDb({ runtime: "workers", role: "app" }, use)).rejects.toThrow("DATABASE_URL_INVALID");
    if (app.runtime === "node" && worker.runtime === "node") {
      await expect(withDb({ ...app, pool: worker.pool }, use)).rejects.toThrow("DATABASE_PRINCIPAL_INVALID");
    } else {
      await expect(withDb({ runtime: "workers", role: "app", APP_HYPERDRIVE: { connectionString: fixture.workerURL } }, use)).rejects.toThrow("DATABASE_URL_INVALID");
      const withOptions = new URL(fixture.appURL);
      withOptions.searchParams.set("options", "endpoint=fixture");
      await expect(withDb({ runtime: "workers", role: "app", APP_HYPERDRIVE: { connectionString: withOptions.href } }, use)).rejects.toThrow("DATABASE_URL_INVALID");
      // A deployed binding has a generated login name, so a non-Harvest name passes the URL check and the principal check decides.
      const generated = `cf02_${randomBytes(8).toString("hex")}`;
      await fixture.admin.query(`CREATE ROLE ${generated} LOGIN PASSWORD 'cf02-generated-fixture' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
      try {
        const hyperdrive = new URL(fixture.appURL);
        hyperdrive.username = generated;
        hyperdrive.password = "cf02-generated-fixture";
        await expect(withDb({ runtime: "workers", role: "app", APP_HYPERDRIVE: { connectionString: hyperdrive.href } }, use)).rejects.toThrow("DATABASE_PRINCIPAL_INVALID");
        hyperdrive.username = fixture.migrationOwner!;
        await expect(withDb({ runtime: "workers", role: "app", APP_HYPERDRIVE: { connectionString: hyperdrive.href } }, use)).rejects.toThrow(/not permitted to log in|password authentication failed/);
      } finally { await fixture.admin.query(`DROP ROLE ${generated}`); }
    }
    expect(use).not.toHaveBeenCalled();
  });

  it("checks the expected database name on the connection, not in the binding URL", async () => {
    const name = (await fixture.admin.query<{ name: string }>("select current_database() as name")).rows[0].name;
    await expect(withDb({ ...app, database: name }, async (db) => (await db.execute(sql`select 1 as one`)).rows.length)).resolves.toBe(1);
    const use = vi.fn(async () => undefined);
    await expect(withDb({ ...app, database: `${name}_other` }, use)).rejects.toThrow("DATABASE_PRINCIPAL_INVALID");
    expect(use).not.toHaveBeenCalled();
  });
});
