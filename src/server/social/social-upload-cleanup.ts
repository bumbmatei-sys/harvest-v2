import type { Pool } from "pg";
import type { createPool } from "../../db/pool";
import { fileKey } from "../../lib/files";
import { requireWorkerRole, workerDatabaseUrl } from "../worker-role";

type CleanupStorage = { deleteObject(key: string): Promise<void>; abortMultipart(key: string, uploadId: string): Promise<void> };
type Claim = { id: string; tenant_id: string; object_key: string; multipart_id: string | null };
const batchSize = 50;

async function cleanOne(pool: Pool, storage: CleanupStorage, skipped: string[]) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("begin");
    const { rows: [item] } = await client.query<Claim>("select * from public.social_upload_cleanup_claim($1)", [skipped]);
    if (!item) { await client.query("commit"); return null; }
    try {
      if (item.object_key !== fileKey(item.tenant_id, item.id)) throw new Error("SOCIAL_UPLOAD_KEY_INVALID");
      if (item.multipart_id) await storage.abortMultipart(item.object_key, item.multipart_id);
      await storage.deleteObject(item.object_key);
      const { rows: [result] } = await client.query<{ deleted: boolean }>(
        "select public.social_upload_cleanup_finish($1,$2) as deleted", [item.tenant_id, item.id]);
      if (!result?.deleted) throw new Error("SOCIAL_UPLOAD_CLEANUP_STALE");
    } catch {
      await client.query("rollback");
      return { id: item.id, deleted: false };
    }
    await client.query("commit");
    return { id: item.id, deleted: true };
  } catch (error) {
    await client.query("rollback").catch(() => { discard = true; });
    throw error;
  } finally { client.release(discard); }
}

async function pending(pool: Pool) {
  const { rows: [row] } = await pool.query<{ pending: boolean }>("select public.social_upload_cleanup_pending() as pending");
  if (typeof row?.pending !== "boolean") throw new Error("SOCIAL_UPLOAD_CLEANUP_INVALID_RESULT");
  return row.pending;
}

export async function sweepSocialUploads(pool: Pool, storage: CleanupStorage) {
  const skipped: string[] = [];
  let deleted = 0;
  for (let index = 0; index < batchSize; index++) {
    const result = await cleanOne(pool, storage, skipped);
    if (!result) break;
    if (result.deleted) deleted++;
    else skipped.push(result.id);
  }
  return { deleted, failed: skipped.length, backlog: await pending(pool) };
}

export async function runSocialUploadCleanupWorker(mode: string, env: Record<string, string | undefined>,
  openPool: typeof createPool, storage: () => CleanupStorage, output: { log(line: string): void; error(line: string): void }) {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.HARVEST_SOCIAL_UPLOAD_CLEANUP_ENABLED !== "1" ||
    (env.NODE_ENV !== "development" && env.NODE_ENV !== "test" && env.VERCEL_ENV !== "preview")) return 0;
  let pool: Pool | undefined;
  const alert = (reason: "failed" | "backlog") => output.error(JSON.stringify({ event: "social_upload_cleanup_alert", reason }));
  try {
    if (mode !== "run" && mode !== "check") throw new Error("SOCIAL_UPLOAD_CLEANUP_USAGE");
    pool = openPool(workerDatabaseUrl(env));
    pool.on("error", () => alert("failed"));
    await requireWorkerRole(pool);
    const result = mode === "check" ? { failed: 0, backlog: await pending(pool) } : await sweepSocialUploads(pool, {
      deleteObject: key => storage().deleteObject(key), abortMultipart: (key, id) => storage().abortMultipart(key, id),
    });
    output.log(JSON.stringify(result));
    if (result.failed) alert("failed");
    if (result.backlog) alert("backlog");
    return result.failed || result.backlog ? 1 : 0;
  } catch {
    alert("failed");
    return 1;
  } finally { await pool?.end().catch(() => alert("failed")); }
}
