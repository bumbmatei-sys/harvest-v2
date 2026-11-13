import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import { Pool, escapeLiteral } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../src/db/schema";
import migrationJournal from "../drizzle/meta/_journal.json";

export const migrationCount = migrationJournal.entries.length;

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local test port available");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
export async function testDatabase(options: { migrationOwner?: boolean; beforeHc06bMigration?: (admin: Pool) => Promise<void>; beforeUserProfilesMigration?: (admin: Pool) => Promise<void>; beforeCommunityApplicationsMigration?: (admin: Pool) => Promise<void>; beforeHc06aMigration?: (admin: Pool) => Promise<void>; beforeFilesMigration?: (admin: Pool) => Promise<void>; beforeShellMigration?: (admin: Pool) => Promise<void>; beforeFollowupMigration?: (admin: Pool) => Promise<void>; beforeCrmMigration?: (admin: Pool) => Promise<void>; beforeCrm03Migration?: (admin: Pool) => Promise<void>; beforeCrm04Migration?: (admin: Pool) => Promise<void>; beforeCrm05Migration?: (admin: Pool) => Promise<void>; beforeCampaignMigration?: (admin: Pool) => Promise<void>; beforeCrm06Migration?: (admin: Pool) => Promise<void>; beforeCrm07Migration?: (admin: Pool) => Promise<void>; beforeHc02Migration?: (admin: Pool) => Promise<void>; beforeHc03Migration?: (admin: Pool) => Promise<void> } = {}) {
  let embedded: EmbeddedPostgres | undefined;
  let stoppingEmbedded = false;
  const poolErrors: Error[] = [];
  function observePool(pool: Pool) {
    // pg can emit an idle-client shutdown error after Pool.end resolves. Handle
    // that expected local shutdown without serializing the client's credentials.
    pool.on("error", (error) => {
      const rawCode = (error as { code?: unknown }).code;
      const code = typeof rawCode === "string" && /^[A-Z0-9]{5}$/.test(rawCode) ? rawCode : "unknown";
      if (stoppingEmbedded && code === "57P01") return;
      poolErrors.push(new Error(`Unexpected test database pool error (${code})`));
    });
    return pool;
  }
  let adminURL = process.env.TEST_DATABASE_URL;
  if (adminURL) {
    const url = new URL(adminURL);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.startsWith("/harvest_test")) throw new Error("Tests require an explicit local harvest_test database.");
  } else {
    const port = await freePort();
    const password = randomBytes(24).toString("hex");
    embedded = new EmbeddedPostgres({ databaseDir: join(await mkdtemp(join(tmpdir(), "harvest-pg-")), "data"), port, user: "postgres", password,
      persistent: false, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
    await embedded.initialise(); await embedded.start();
    adminURL = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  }
  const root = observePool(new Pool({ connectionString: adminURL, max: 1 }));
  // Roles are cluster-wide and provisioned outside the migrations; the worker role must exist before 0044 so its grants apply.
  await root.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN CREATE ROLE harvest_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
  const name = `harvest_test_${randomBytes(8).toString("hex")}`;
  const migrationOwner = options.migrationOwner ? `hc06b_owner_${randomBytes(8).toString("hex")}` : null;
  if (migrationOwner) {
    await root.query(`CREATE ROLE ${migrationOwner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    await root.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_app') THEN CREATE ROLE harvest_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$");
  }
  await root.query(`CREATE DATABASE ${name}${migrationOwner ? ` OWNER ${migrationOwner}` : ""}`);
  const url = new URL(adminURL); url.pathname = `/${name}`;
  const admin = observePool(new Pool({ connectionString: url.toString(), max: 1 }));
  if (migrationOwner) await admin.query(`SET ROLE ${migrationOwner}`);
  for (const [lastIndex, seed] of [[3, options.beforeFilesMigration], [4, options.beforeShellMigration], [7, options.beforeFollowupMigration], [10, options.beforeCrmMigration], [12, options.beforeCrm03Migration], [14, options.beforeCrm04Migration], [17, options.beforeCrm05Migration], [20, options.beforeCampaignMigration], [21, options.beforeCrm06Migration], [23, options.beforeCrm07Migration], [25, options.beforeHc02Migration], [26, options.beforeHc03Migration], [30, options.beforeHc06aMigration], [31, options.beforeHc06bMigration], [33, options.beforeUserProfilesMigration], [36, options.beforeCommunityApplicationsMigration]] as const) {
    if (!seed) continue;
    const mainFolder = await mkdtemp(join(tmpdir(), "harvest-main-migrations-"));
    try {
      await cp("drizzle", mainFolder, { recursive: true });
      const journalPath = join(mainFolder, "meta/_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= lastIndex);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(drizzle(admin), { migrationsFolder: mainFolder });
      if (migrationOwner) await admin.query("RESET ROLE");
      await seed(admin);
      if (migrationOwner) await admin.query(`SET ROLE ${migrationOwner}`);
    } finally { await rm(mainFolder, { recursive: true, force: true }); }
  }
  await migrate(drizzle(admin), { migrationsFolder: "drizzle" });
  // Applying the same migrations twice must be a no-op.
  await migrate(drizzle(admin), { migrationsFolder: "drizzle" });
  if (migrationOwner) await admin.query("RESET ROLE");
  const appPassword = randomBytes(24).toString("hex");
  await admin.query(`ALTER ROLE harvest_app LOGIN PASSWORD ${escapeLiteral(appPassword)}`);
  url.username = "harvest_app"; url.password = appPassword;
  // max:1 guarantees physical backend reuse, rather than merely hoping a pool reuses it.
  const pool = observePool(new Pool({ connectionString: url.toString(), max: 1 }));
  const db = drizzle(pool, { schema });
  const appURL = url.toString();
  // The background-worker login: EXECUTE on the six worker functions only (0044), no table privileges.
  const workerPassword = randomBytes(24).toString("hex");
  await admin.query(`ALTER ROLE harvest_worker LOGIN PASSWORD ${escapeLiteral(workerPassword)}`);
  url.username = "harvest_worker"; url.password = workerPassword;
  const workerURL = url.toString();
  const workerPool = observePool(new Pool({ connectionString: workerURL, max: 1 }));
  return { db, pool, workerPool, admin, migrationOwner, appURL, workerURL, async close() {
    await pool.end(); await workerPool.end(); await admin.end();
    await root.query(`DROP DATABASE ${name}`);
    if (migrationOwner) await root.query(`DROP ROLE ${migrationOwner}`);
    await root.end();
    stoppingEmbedded = true; await embedded?.stop();
    if (poolErrors.length) throw new AggregateError(poolErrors, "Test database pool failed");
  } };
}
