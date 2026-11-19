import { createPool } from "../src/db/pool";
import { chatPurgeHealth, runChatPurgeJob } from "../src/server/community-chat-retention";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";

let pool: ReturnType<typeof createPool> | undefined;
try {
  const mode = process.argv[2] ?? "run";
  if (process.argv.length > 3 || (mode !== "run" && mode !== "check")) throw new Error("CHAT_PURGE_USAGE");
  pool = createPool(workerDatabaseUrl());
  pool.on("error", () => console.error("community_chat_purge_pool_failed"));
  await requireWorkerRole(pool);
  if (mode === "check") {
    const health = await chatPurgeHealth(pool);
    console.log(JSON.stringify(health));
    if (!health.healthy) process.exitCode = 1;
  } else {
    const outcome = await runChatPurgeJob(pool);
    console.log(JSON.stringify(outcome));
    if (!outcome.ok) {
      console.error("community_chat_purge_failed");
      process.exitCode = 1;
    }
  }
} catch {
  console.error("community_chat_purge_failed");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
