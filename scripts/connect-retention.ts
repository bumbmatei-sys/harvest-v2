import { createPool } from "../src/db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";
import { retentionHealth, runRetentionJob } from "../src/server/connect-retention";

// Connect retention (HC-DEC3 and HC-DEC4 engineering; the policy numbers are unapproved defaults).
//   npm run connect:retention            erase expired responses and delete expired tombstones, in all ministries
//   npm run connect:retention -- check   print the health and exit 1 if no run succeeded recently or the last one failed
// Runs as the dedicated harvest_worker role through WORKER_DATABASE_URL (never DATABASE_URL) and prints counts only. Scheduling both commands is an activation step; nothing here sends anything.
let pool: ReturnType<typeof createPool> | undefined;
try {
  const mode = process.argv[2] ?? "run";
  if (mode !== "run" && mode !== "check") throw new Error("USAGE");
  pool = createPool(workerDatabaseUrl());
  pool.on("error", () => console.error("connect_retention_pool_failed"));
  await requireWorkerRole(pool);
  if (mode === "check") {
    const health = await retentionHealth(pool);
    console.log(JSON.stringify(health));
    if (!health.healthy) process.exitCode = 1;
  } else {
    const outcome = await runRetentionJob(pool);
    console.log(JSON.stringify(outcome));
    if (!outcome.ok) { console.error("connect_retention_failed"); process.exitCode = 1; }
  }
} catch { console.error("connect_retention_failed"); process.exitCode = 1; }
finally { await pool?.end(); }
