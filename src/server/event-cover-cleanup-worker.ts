import type { Pool } from "pg";
import type { createPool } from "../db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "./worker-role";

type Storage = { deleteObject(key: string): Promise<void> };
const batchSize = 50;
const takeRecord = "select * from public.events_cover_cleanup_record($1::uuid, $2::uuid[])";
type CleanupRecord = { file_id: string; object_key: string | null };

async function cleanOne(pool: Pool, storage: Storage, skipped: string[]) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("begin");
    const { rows: [job] } = await client.query<CleanupRecord>(takeRecord, [null, skipped]);
    if (!job?.object_key) {
      await client.query("commit");
      return job && { id: job.file_id, outcome: "deferred" as const };
    }
    try {
      await storage.deleteObject(job.object_key);
    } catch {
      await client.query("rollback");
      return { id: job.file_id, outcome: "failed" as const };
    }
    const { rows: [completed] } = await client.query<CleanupRecord>(takeRecord, [job.file_id, []]);
    if (completed?.object_key !== job.object_key) throw new Error("EVENT_COVER_CLEANUP_NOT_COMPLETED");
    await client.query("commit");
    return { id: job.file_id, outcome: "deleted" as const };
  } catch (error) {
    await client.query("rollback").catch(() => { discard = true; });
    throw error;
  } finally {
    client.release(discard);
  }
}

async function pending(pool: Pool) {
  const { rows: [row] } = await pool.query<{ pending: boolean }>("select public.events_cover_cleanup_pending() as pending");
  if (typeof row?.pending !== "boolean") throw new Error("EVENT_COVER_CLEANUP_INVALID_RESULT");
  return row.pending;
}

export async function sweepEventCovers(pool: Pool, storage: Storage) {
  const { rows: [row] } = await pool.query<{ retired: number }>(
    "select public.events_cover_retire_abandoned($1) as retired", [batchSize]);
  if (!Number.isInteger(row?.retired) || row.retired < 0 || row.retired > batchSize) throw new Error("EVENT_COVER_CLEANUP_INVALID_RESULT");
  let deleted = 0, failed = 0;
  const skipped: string[] = [];
  for (let i = 0; i < batchSize; i++) {
    const result = await cleanOne(pool, storage, skipped);
    if (!result) break;
    if (result.outcome === "deleted") deleted++;
    else skipped.push(result.id);
    if (result.outcome === "failed") failed++;
  }
  return { retired: row.retired, deleted, failed, backlog: await pending(pool) };
}

export async function runEventCoverCleanupWorker(
  mode: string,
  env: Record<string, string | undefined>,
  openPool: typeof createPool,
  storage: () => Storage,
  output: { log(line: string): void; error(line: string): void },
): Promise<number> {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production" ||
      env.HARVEST_EVENT_COVER_CLEANUP_ENABLED !== "1" ||
      (env.NODE_ENV !== "development" && env.NODE_ENV !== "test" && env.VERCEL_ENV !== "preview")) return 0;

  let pool: Pool | undefined;
  const alert = (reason: "failed" | "backlog") => output.error(JSON.stringify({ event: "event_cover_cleanup_alert", reason }));
  try {
    if (mode !== "run" && mode !== "check") throw new Error("EVENT_COVER_CLEANUP_USAGE");
    pool = openPool(workerDatabaseUrl(env));
    pool.on("error", () => alert("failed"));
    await requireWorkerRole(pool);
    const outcome = mode === "check" ? { failed: 0, backlog: await pending(pool) }
      : await sweepEventCovers(pool, { deleteObject: key => storage().deleteObject(key) });
    output.log(JSON.stringify(outcome));
    if (outcome.failed) alert("failed");
    if (outcome.backlog) alert("backlog");
    return outcome.failed || outcome.backlog ? 1 : 0;
  } catch {
    alert("failed");
    return 1;
  } finally {
    await pool?.end().catch(() => alert("failed"));
  }
}
