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

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local test port available");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
export async function testDatabase(options: { beforeFilesMigration?: (admin: Pool) => Promise<void> } = {}) {
  let embedded: EmbeddedPostgres | undefined;
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
  const root = new Pool({ connectionString: adminURL, max: 1 });
  const name = `harvest_test_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE DATABASE ${name}`);
  const url = new URL(adminURL); url.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url.toString(), max: 1 });
  if (options.beforeFilesMigration) {
    // Build an isolated main+#3 migration folder; repository metadata stays untouched.
    const mainFolder = await mkdtemp(join(tmpdir(), "harvest-main-migrations-"));
    try {
      await cp("drizzle", mainFolder, { recursive: true });
      const journalPath = join(mainFolder, "meta/_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 3);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(drizzle(admin), { migrationsFolder: mainFolder });
      await options.beforeFilesMigration(admin);
    } finally { await rm(mainFolder, { recursive: true, force: true }); }
  }
  await migrate(drizzle(admin), { migrationsFolder: "drizzle" });
  // Applying the same migrations twice must be a no-op.
  await migrate(drizzle(admin), { migrationsFolder: "drizzle" });
  const appPassword = randomBytes(24).toString("hex");
  await admin.query(`ALTER ROLE harvest_app LOGIN PASSWORD ${escapeLiteral(appPassword)}`);
  url.username = "harvest_app"; url.password = appPassword;
  // max:1 guarantees physical backend reuse, rather than merely hoping a pool reuses it.
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const db = drizzle(pool, { schema });
  return { db, pool, admin, appURL: url.toString(), async close() {
    await pool.end(); await admin.end();
    await root.query(`DROP DATABASE ${name}`); await root.end(); await embedded?.stop();
  } };
}
