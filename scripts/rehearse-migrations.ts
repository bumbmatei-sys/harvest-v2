import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Client } from "pg";
import journal from "../drizzle/meta/_journal.json";

const baseline = "0030_";
const lockThreshold = 5_000;
const timings: string[] = [];
const locks = new Map<string, number>();
let step = "local database validation";
let migration = "";
let stopSampling = false;
let failure: string | undefined;
let cleanupFailure: string | undefined;

function connection() {
  const url = new URL(process.env.REHEARSAL_DATABASE_URL ?? "");
  // Accept only the dedicated maintenance database on disposable loopback Postgres.
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !url.port ||
      url.pathname !== "/harvest_rehearsal" || url.search || url.hash || !url.username || !url.password) {
    throw new Error("Expected a dedicated local rehearsal URL");
  }
  return {
    host: url.hostname, port: Number(url.port), database: "harvest_rehearsal",
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: false, connectionTimeoutMillis: 5_000,
  };
}

function code(error: unknown) {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === "string" && /^[A-Z0-9_]{5,20}$/.test(value) ? value : "check_failed";
}

type Lock = { locktype: string; resource: string; mode: string; granted: boolean };
async function sampleLocks(observer: Client, pid: number) {
  const firstSeen = new Map<string, { at: number; migration: string }>();
  while (!stopSampling) {
    const { rows } = await observer.query<Lock>(
      `select locktype, concat_ws('/', database, relation::regclass::text, page, tuple,
           transactionid, virtualxid, classid, objid, objsubid) as resource, mode, granted
       from pg_locks where pid = $1`, [pid]);
    const now = performance.now();
    const present = new Set<string>();
    for (const row of rows) {
      const key = `${row.locktype} ${row.resource} ${row.mode} ${row.granted ? "held" : "waiting"}`;
      present.add(key);
      const first = firstSeen.get(key) ?? { at: now, migration };
      firstSeen.set(key, first);
      const elapsed = now - first.at;
      if (elapsed > lockThreshold) locks.set(`${first.migration} ${key}`, elapsed);
    }
    for (const key of firstSeen.keys()) if (!present.has(key)) firstSeen.delete(key);
    await setTimeout(100);
  }
}

const files = readMigrationFiles({ migrationsFolder: "drizzle" });

async function apply(db: Client, start: number, end: number, report: boolean) {
  await db.query("begin");
  try {
    await db.query("set local statement_timeout = '120s'");
    for (let index = start; index < end; index++) {
      const entry = journal.entries[index];
      migration = entry.tag;
      step = migration;
      const started = performance.now();
      try {
        for (const statement of files[index].sql) await db.query(statement);
        await db.query("insert into drizzle.__drizzle_migrations(hash, created_at) values($1, $2)",
          [files[index].hash, files[index].folderMillis]);
      } finally {
        if (report) timings.push(`${migration.slice(0, 4)} ${Math.round(performance.now() - started)}ms`);
      }
    }
    step = "commit migration batch";
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function verify(db: Client, owner: string, tenant: string) {
  step = "journal and synthetic seed";
  const { rows: [state] } = await db.query(`select
    (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
    (select count(*)::int from user_profiles where user_id like 'rehearsal-%' and onboarding_skipped_at is not null) as profiles`);
  if (state.migrations !== files.length || state.profiles !== 2) throw new Error("Journal or backfill mismatch");

  step = "definer ownership and search path";
  const { rows: definers } = await db.query(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (pg_get_userbyid(p.proowner) <> $1 or not exists (
        select from unnest(p.proconfig) as setting where setting like 'search_path=%'))`, [owner]);
  if (definers.length) throw new Error("Definer ownership or search path mismatch");

  step = "forced RLS and worker grants";
  const { rows: violations } = await db.query(`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and ((c.relrowsecurity and not c.relforcerowsecurity)
        or (c.relkind <> 'S' and has_table_privilege('harvest_worker', c.oid,
          'select, insert, update, delete, truncate, references, trigger'))
        or (c.relkind = 'S' and has_sequence_privilege('harvest_worker', c.oid, 'usage, select, update')))`);
  if (violations.length) throw new Error("Forced RLS or worker grant mismatch");

  step = "restricted application tenant isolation";
  await db.query("begin");
  try {
    await db.query("set local role harvest_app");
    const empty = await db.query("select tenant_id from workspaces");
    await db.query("select set_config('app.tenant_id', $1, true)", [tenant]);
    const scoped = await db.query("select tenant_id from workspaces");
    if (empty.rowCount !== 0 || scoped.rowCount !== 1 || scoped.rows[0].tenant_id !== tenant) {
      throw new Error("Tenant isolation mismatch");
    }
  } finally {
    await db.query("rollback");
  }

  step = "worker-only definer execution";
  const { rows: [grant] } = await db.query(`select
    has_function_privilege('harvest_worker', 'public.connect_retention_health()', 'execute') as worker,
    has_function_privilege('harvest_app', 'public.connect_retention_health()', 'execute') as app`);
  if (!grant.worker || grant.app) throw new Error("Retention execute grant mismatch");
  await db.query("begin");
  try {
    await db.query("set local role harvest_worker");
    await db.query("select public.connect_retention_health()");
  } finally {
    await db.query("rollback");
  }
}

async function rehearse() {
  const config = connection();
  const root = new Client(config);
  const suffix = randomUUID().replaceAll("-", "");
  const database = `harvest_rehearsal_${suffix}`;
  const owner = `rehearsal_owner_${suffix}`;
  const db = new Client({ ...config, database });
  const observer = new Client({ ...config, database });
  const roles: string[] = [];
  let databaseCreated = false;
  try {
    await root.connect();
    step = "disposable database provisioning";
    await root.query("select pg_advisory_lock(33800, 4)");
    for (const role of ["harvest_app", "harvest_worker", owner]) {
      const existing = await root.query("select 1 from pg_roles where rolname = $1", [role]);
      if (existing.rowCount) continue;
      await root.query(`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
      roles.push(role);
    }
    await root.query(`create database ${database} owner ${owner} template template0`);
    databaseCreated = true;
    await db.connect();
    await db.query(`set role ${owner}`);
    await db.query("create schema drizzle");
    await db.query("create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)");

    const endOfBaseline = journal.entries.findIndex(({ tag }) => tag.startsWith(baseline)) + 1;
    if (!endOfBaseline || !journal.entries[endOfBaseline]?.tag.startsWith("0031_")) throw new Error("Missing rehearsal boundary");
    await apply(db, 0, endOfBaseline, false);
    step = "synthetic seed at 0030";
    await db.query("reset role");
    const tenant = randomUUID();
    for (const [id, tenantId] of [["rehearsal-one", tenant], ["rehearsal-two", randomUUID()]]) {
      await db.query("insert into users(id, name, email) values($1, 'Synthetic user', $2)", [id, `${id}@example.invalid`]);
      await db.query("insert into workspaces(tenant_id, name, created_by) values($1, 'Synthetic ministry', $2)", [tenantId, id]);
      await db.query("insert into contacts(tenant_id, name) values($1, 'Synthetic contact')", [tenantId]);
    }

    await db.query(`set role ${owner}`);
    await observer.connect();
    const { rows: [{ pid }] } = await db.query("select pg_backend_pid() as pid");
    migration = journal.entries[endOfBaseline].tag;
    let samplingError: unknown;
    const sampling = sampleLocks(observer, pid).catch((error: unknown) => { samplingError = error; });
    try {
      await apply(db, endOfBaseline, files.length, true);
    } finally {
      stopSampling = true;
      await sampling;
    }
    step = "lock sampling";
    if (samplingError) throw samplingError;
    await db.query("reset role");
    await verify(db, owner, tenant);
  } catch (error) {
    failure = `${step} (${code(error)})`;
  } finally {
    await Promise.allSettled([db.end(), observer.end()]);
    try {
      if (databaseCreated) await root.query(`drop database ${database} with (force)`);
      for (const role of roles.reverse()) await root.query(`drop role ${role}`);
    } catch (error) {
      cleanupFailure = code(error);
    } finally {
      await root.end();
    }
  }
}

try {
  await rehearse();
} catch (error) {
  failure = `${step} (${code(error)})`;
}
console.info("QA-4 migration rehearsal");
console.info("Baseline: 0030 (scenario assumption). Target: disposable local PostgreSQL.");
console.info(`Migration time (SQL and journal write): ${timings.length} attempted`);
for (let index = 0; index < timings.length; index += 6) console.info(timings.slice(index, index + 6).join("   "));
console.info("Locks observed longer than 5 seconds (100ms sampling; first observed migration):");
if (!locks.size) console.info(failure ? "None observed before failure." : "None observed.");
if (locks.size) {
  const ranked = [...locks].sort((a, b) => b[1] - a[1]);
  const waiting = ranked.filter(([lock]) => lock.endsWith(" waiting"));
  const held = ranked.filter(([lock]) => lock.endsWith(" held"));
  console.info(`  ${held.length} held, ${waiting.length} waiting. Longest per group (up to 5):`);
  for (const [lock, ms] of [...held.slice(0, 5), ...waiting.slice(0, 5)]) {
    console.info(`  ${(ms / 1_000).toFixed(1)}s ${lock}`);
  }
}
console.info(`Failures: ${failure ?? "none"}${cleanupFailure ? `; cleanup (${cleanupFailure})` : ""}`);
if (failure || cleanupFailure) process.exitCode = 1;
else console.info("Journal, backfill, RLS, worker grants and definer ownership checks passed.");
