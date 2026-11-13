import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { requireWorkerRole } from "../../src/server/worker-role";

// Migration 0044: the six background-worker functions belong to harvest_worker alone, and that role has no table access.
const workerFunctions = [
  ["public.community_email_enqueue(integer)", "select public.community_email_enqueue(1)"],
  ["public.community_email_claim(integer)", "select public.community_email_claim(1)"],
  ["public.community_email_complete(uuid,text,text)", `select public.community_email_complete('${randomUUID()}'::uuid, 'sent', null)`],
  ["public.connect_retention_sweep(integer)", "select public.connect_retention_sweep(1)"],
  ["public.connect_retention_record_failure(text)", "select public.connect_retention_record_failure('sweep_failed')"],
  ["public.connect_retention_health()", "select public.connect_retention_health()"],
] as const;
const webFunctions = ["public.community_email_prefs_save(text,text)", "public.community_email_unsubscribe(uuid,uuid,text)", "public.community_purge_notifications()"];
const exec = promisify(execFile);
let f: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { f = await testDatabase(); });
afterAll(async () => { await f?.close(); });

it("is provisioned as an unprivileged login that is not the application role", async () => {
  const { rows: [role] } = await f.admin.query("select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin from pg_roles where rolname = 'harvest_worker'");
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolinherit: false, rolcanlogin: true });
  expect((await f.admin.query("select count(*)::int n from pg_auth_members where member = 'harvest_worker'::regrole")).rows[0].n).toBe(0);
  expect((await f.workerPool.query("select current_user as u")).rows[0].u).toBe("harvest_worker");
});

it("lets the worker role call the six worker functions", async () => {
  for (const [signature, call] of workerFunctions) {
    expect((await f.admin.query("select has_function_privilege('harvest_worker', $1, 'execute') as ok", [signature])).rows[0].ok, signature).toBe(true);
    await expect(f.workerPool.query(call), signature).resolves.toBeDefined();
  }
});

it("denies the application role the six worker functions (permission denied)", async () => {
  for (const [signature, call] of workerFunctions) {
    expect((await f.admin.query("select has_function_privilege('harvest_app', $1, 'execute') as ok", [signature])).rows[0].ok, signature).toBe(false);
    await expect(f.pool.query(call), signature).rejects.toMatchObject({ code: "42501" });
  }
  // The web-facing definers are untouched.
  for (const signature of webFunctions) expect((await f.admin.query("select has_function_privilege('harvest_app', $1, 'execute') as ok", [signature])).rows[0].ok, signature).toBe(true);
});

it("gives the worker role nothing else: no table, sequence or web-definer privileges", async () => {
  const { rows } = await f.admin.query(`select c.relname, c.relkind,
    (has_table_privilege('harvest_worker', c.oid, 'select') or has_table_privilege('harvest_worker', c.oid, 'insert') or has_table_privilege('harvest_worker', c.oid, 'update')
      or has_table_privilege('harvest_worker', c.oid, 'delete') or has_table_privilege('harvest_worker', c.oid, 'truncate') or has_table_privilege('harvest_worker', c.oid, 'references')
      or has_table_privilege('harvest_worker', c.oid, 'trigger')) as any_table_privilege
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')`);
  expect(rows.length).toBeGreaterThan(50);
  expect(rows.filter((row) => row.any_table_privilege).map((row) => row.relname)).toEqual([]);
  const { rows: sequences } = await f.admin.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S' and (has_sequence_privilege('harvest_worker', c.oid, 'usage') or has_sequence_privilege('harvest_worker', c.oid, 'select') or has_sequence_privilege('harvest_worker', c.oid, 'update'))`);
  expect(sequences).toEqual([]);
  for (const signature of webFunctions) expect((await f.admin.query("select has_function_privilege('harvest_worker', $1, 'execute') as ok", [signature])).rows[0].ok, signature).toBe(false);
  for (const table of ["community_email_deliveries", "community_memberships", "users", "campaign_responses", "connect_retention_runs"]) {
    await expect(f.workerPool.query(`select * from ${table}`), table).rejects.toMatchObject({ code: "42501" });
  }
  await expect(f.workerPool.query("delete from connect_retention_runs")).rejects.toMatchObject({ code: "42501" });
});

it("makes the worker scripts' role check refuse anything but the worker login", async () => {
  await expect(requireWorkerRole(f.workerPool)).resolves.toBeUndefined();
  await expect(requireWorkerRole(f.pool)).rejects.toThrow("WORKER_ROLE_REQUIRED");
  await expect(requireWorkerRole(f.admin)).rejects.toThrow("WORKER_ROLE_REQUIRED");
});

it("runs the retention script only as the worker role, reading WORKER_DATABASE_URL", async () => {
  const run = (env: Record<string, string | undefined>) => exec(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/connect-retention.ts", "check"],
    { env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, ...env }, timeout: 30_000 }).then((r) => ({ code: 0, stdout: r.stdout }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  // The application login, or only DATABASE_URL, is refused before any worker function is called.
  expect(await run({ WORKER_DATABASE_URL: f.appURL })).toMatchObject({ code: 1, stdout: "" });
  expect(await run({ DATABASE_URL: f.workerURL })).toMatchObject({ code: 1, stdout: "" });
  // The worker login gets as far as the health check: it prints the health (unhealthy here, an earlier test recorded a failure) and exits 1.
  const ok = await run({ WORKER_DATABASE_URL: f.workerURL, DATABASE_URL: f.appURL });
  expect(JSON.parse(ok.stdout)).toMatchObject({ healthy: false, failedSinceSuccess: true });
});

it("runs the community email script only as the worker role, reading WORKER_DATABASE_URL", async () => {
  const base = { HARVEST_COMMUNITY_EMAIL: "test", HARVEST_COMMUNITY_TEST_MAILBOX: join(tmpdir(), `harvest-worker-role-${randomUUID()}.jsonl`), BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "synthetic-test-secret" };
  const run = (env: Record<string, string | undefined>) => exec(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/send-community-email.ts"],
    { env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, ...base, ...env }, timeout: 30_000 }).then((r) => ({ code: 0, stdout: r.stdout }), (e: { code: number; stdout: string }) => ({ code: e.code, stdout: e.stdout }));
  expect(await run({ WORKER_DATABASE_URL: f.appURL })).toMatchObject({ code: 1, stdout: "" });
  expect(await run({ DATABASE_URL: f.workerURL })).toMatchObject({ code: 1, stdout: "" });
  expect(JSON.parse((await run({ WORKER_DATABASE_URL: f.workerURL, DATABASE_URL: f.appURL })).stdout)).toMatchObject({ queued: expect.any(Number), sent: expect.any(Number), failed: 0 });
});

// 0044 must be safe wherever the role is provisioned later: it never creates the role, and it refuses a role that is not unprivileged.
async function migrationBody() {
  const sql = await readFile("drizzle/0044_worker_db_role.sql", "utf8");
  return sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
}
it("applies cleanly when the worker role does not exist, granting nothing", async () => {
  const absent = `hw_absent_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  for (const statement of await migrationBody()) await f.admin.query(statement.replaceAll("harvest_worker", absent));
  expect((await f.admin.query("select count(*)::int n from pg_roles where rolname = $1", [absent])).rows[0].n).toBe(0);
  // Re-applying the real statements is a no-op for the existing worker role and keeps harvest_app out.
  for (const statement of await migrationBody()) await f.admin.query(statement);
  for (const [signature] of workerFunctions) {
    expect((await f.admin.query("select has_function_privilege('harvest_worker', $1, 'execute') as ok", [signature])).rows[0].ok).toBe(true);
    expect((await f.admin.query("select has_function_privilege('harvest_app', $1, 'execute') as ok", [signature])).rows[0].ok).toBe(false);
  }
});
it("refuses to grant to a worker role that is privileged", async () => {
  const bad = `hw_bad_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await f.admin.query(`create role ${bad} nologin createdb`);
  try {
    const statements = await migrationBody();
    await f.admin.query(statements[0]);
    await expect(f.admin.query(statements[1].replaceAll("harvest_worker", bad))).rejects.toThrow("must be an unprivileged SQL-created role");
  } finally { await f.admin.query(`drop role ${bad}`); }
});
