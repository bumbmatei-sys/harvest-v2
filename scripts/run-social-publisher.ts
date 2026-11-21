import type { PoolClient } from "pg";
import { createPool } from "../src/db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";
import { FakeProvider } from "../src/server/social/fake-provider";
import { runSocialPublisher } from "../src/server/social/publisher";
import { fakePublisherLease } from "../src/server/social/publisher-lease";

// Posting worker. TEST MODE ONLY: it publishes to an in-memory fake provider, so nothing can leave this process. It refuses to
// run unless HARVEST_SOCIAL_PUBLISHER=test and the database is local, and the vendor adapter is never constructed here (it is
// itself hard-disabled in code). Runs as the dedicated harvest_worker role through WORKER_DATABASE_URL (never DATABASE_URL).
let pool: ReturnType<typeof createPool> | undefined;
let client: PoolClient | undefined;
try {
  if (process.env.HARVEST_SOCIAL_PUBLISHER !== "test") throw new Error("TEST_MODE_REQUIRED");
  const testDatabaseUrl = workerDatabaseUrl();
  if (!["localhost", "127.0.0.1"].includes(new URL(testDatabaseUrl).hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
  pool = createPool(testDatabaseUrl);
  pool.on("error", () => console.error("social_publisher_pool_failed"));
  await requireWorkerRole(pool);
  const fake = new FakeProvider({ permissive: true });
  const options = {
    releaseMedia: async ({ id }: { id: string }) => ({ url: `https://media.example.test/${id}`, expiresAt: new Date(Date.now() + 60_000) }),
  };
  if (process.argv.includes("--lease")) {
    const db = fakePublisherLease({ runtime: "node", role: "worker", pool }, process.env.HARVEST_SOCIAL_PUBLISHER);
    console.log(JSON.stringify(await runSocialPublisher(db, () => fake, options)));
  } else {
    client = await pool.connect();
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('harvest:social-publisher')) as locked");
    if (!lock.rows[0].locked) console.log(JSON.stringify({ alreadyRunning: true }));
    else {
      try { console.log(JSON.stringify(await runSocialPublisher(client, () => fake, options))); }
      finally { await client.query("select pg_advisory_unlock(hashtext('harvest:social-publisher'))").catch(() => undefined); }
    }
  }
} catch { console.error("social_publisher_failed"); process.exitCode = 1; }
finally { client?.release(); await pool?.end(); }
