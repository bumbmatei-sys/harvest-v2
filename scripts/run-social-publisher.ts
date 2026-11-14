import type { PoolClient } from "pg";
import { createPool } from "../src/db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";
import { FakeProvider } from "../src/server/social/fake-provider";
import { runSocialPublisher } from "../src/server/social/publisher";

// Posting worker. TEST MODE ONLY: it publishes to an in-memory fake provider, so nothing can leave this process. It refuses to
// run unless HARVEST_SOCIAL_PUBLISHER=test and the database is local, and the vendor adapter is never constructed here (it is
// itself hard-disabled in code). Runs as the dedicated harvest_worker role through WORKER_DATABASE_URL (never DATABASE_URL).
let pool: ReturnType<typeof createPool> | undefined;
let client: PoolClient | undefined;
try {
  if (process.env.HARVEST_SOCIAL_PUBLISHER !== "test") throw new Error("TEST_MODE_REQUIRED");
  if (!["localhost", "127.0.0.1"].includes(new URL(workerDatabaseUrl()).hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
  pool = createPool(workerDatabaseUrl());
  pool.on("error", () => console.error("social_publisher_pool_failed"));
  await requireWorkerRole(pool);
  client = await pool.connect();
  const fake = new FakeProvider({ permissive: true });
  const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('harvest:social-publisher')) as locked");
  if (!lock.rows[0].locked) console.log(JSON.stringify({ alreadyRunning: true }));
  else {
    try { console.log(JSON.stringify(await runSocialPublisher(client, () => fake))); }
    finally { await client.query("select pg_advisory_unlock(hashtext('harvest:social-publisher'))").catch(() => undefined); }
  }
} catch { console.error("social_publisher_failed"); process.exitCode = 1; }
finally { client?.release(); await pool?.end(); }
