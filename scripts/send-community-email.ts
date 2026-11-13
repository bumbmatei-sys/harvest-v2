import type { PoolClient } from "pg";
import { createPool } from "../src/db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";
import { runCommunityEmail, withWorkerLock } from "../src/server/community-email";
import { testMailboxSender } from "../src/server/community-email-sender";

// C15b: queues and sends community notification email. TEST MODE ONLY: it writes to a local mailbox file and refuses to
// run unless HARVEST_COMMUNITY_EMAIL=test, a mailbox path is set and the site origin is localhost. The live sender is
// hard-disabled in code. Runs as the dedicated harvest_worker role through WORKER_DATABASE_URL (never DATABASE_URL). Run it every few minutes: digests go out when their window has elapsed.
let pool: ReturnType<typeof createPool> | undefined;
let client: PoolClient | undefined;
try {
  const path = process.env.HARVEST_COMMUNITY_TEST_MAILBOX, origin = new URL(process.env.BETTER_AUTH_URL ?? "");
  if (process.env.HARVEST_COMMUNITY_EMAIL !== "test" || !path || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("TEST_MODE_REQUIRED");
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("SECRET_REQUIRED");
  // Test mode also means a local database: this would otherwise claim real rows and mark them sent without sending anything.
  if (!["localhost", "127.0.0.1"].includes(new URL(workerDatabaseUrl()).hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
  pool = createPool(workerDatabaseUrl());
  pool.on("error", () => console.error("community_email_pool_failed"));
  await requireWorkerRole(pool);
  // One run at a time: the advisory lock lives on this connection, and every query of the run uses it.
  client = await pool.connect();
  const result = await withWorkerLock(client, () => runCommunityEmail(client!, testMailboxSender(path), { origin: origin.origin, secret }));
  console.log(JSON.stringify(result ?? { alreadyRunning: true }));
} catch { console.error("community_email_failed"); process.exitCode = 1; }
finally { client?.release(); await pool?.end(); }
