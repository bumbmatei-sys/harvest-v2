import { chatPurgeHealth, runChatPurgeJob } from "./community-chat-retention";
import { requireWorkerRole, workerDatabaseUrl } from "./worker-role";
import type { createPool } from "../db/pool";

export async function runChatPurgeWorker(
  mode: string,
  env: Record<string, string | undefined>,
  openPool: typeof createPool,
  output: { log(line: string): void; error(line: string): void },
): Promise<number> {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production" ||
      env.HARVEST_CHAT_PURGE_WORKER_ENABLED !== "1" ||
      (env.NODE_ENV !== "development" && env.NODE_ENV !== "test" && env.VERCEL_ENV !== "preview")) return 0;

  let pool: ReturnType<typeof createPool> | undefined;
  try {
    if (mode !== "run" && mode !== "check") throw new Error("CHAT_PURGE_USAGE");
    pool = openPool(workerDatabaseUrl(env));
    pool.on("error", () => output.error("community_chat_purge_pool_failed"));
    await requireWorkerRole(pool);
    if (mode === "check") {
      const health = await chatPurgeHealth(pool);
      output.log(JSON.stringify(health));
      return health.healthy ? 0 : 1;
    }

    const outcome = await runChatPurgeJob(pool);
    output.log(JSON.stringify(outcome));
    if (!outcome.ok) {
      output.error(JSON.stringify({ event: "community_chat_purge_alert", reason: "failed" }));
      return 1;
    }
    if (outcome.channels.capped || outcome.dm?.capped) {
      output.error(JSON.stringify({
        event: "community_chat_purge_alert", reason: "backlog",
        channels: outcome.channels.capped, dm: outcome.dm?.capped ?? false,
      }));
      return 1;
    }
    return 0;
  } catch {
    output.error(JSON.stringify({ event: "community_chat_purge_alert", reason: "failed" }));
    return 1;
  } finally {
    await pool?.end().catch(() => output.error("community_chat_purge_pool_close_failed"));
  }
}
