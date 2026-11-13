import { CONNECT_RETENTION_POLICY } from "../lib/connect-retention";

// Connect retention job (HC-DEC3 and HC-DEC4 engineering). Runs the database sweep until it finds nothing, records a failure
// outside the failed transaction, and reports health for a monitor. Counts only: never a name, address or response id.
type Queryable = { query: <R extends Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> };
export type RetentionResult = { erased: number; deleted: number; failed: number; batches: number };
export type RetentionHealth = { lastSuccessAt: string | null; lastStatus: "ok" | "failed" | null; overdue: boolean; failedSinceSuccess: boolean };
export type RetentionJobOutcome = ({ ok: true } & RetentionResult) | { ok: false };

const BATCH = 200, MAX_BATCHES = 50;

/** Sweeps in batches until a batch erases and deletes nothing (or the safety cap is reached). */
export async function runRetention(pool: Queryable, options: { batch?: number; maxBatches?: number } = {}): Promise<RetentionResult> {
  const batch = options.batch ?? BATCH, maxBatches = options.maxBatches ?? MAX_BATCHES;
  let erased = 0, deleted = 0, failed = 0, batches = 0;
  while (batches < maxBatches) {
    const { rows: [{ result }] } = await pool.query<{ result: { erased: number; deleted: number; failed: number } }>("select public.connect_retention_sweep($1) as result", [batch]);
    batches++; erased += result.erased; deleted += result.deleted; failed += result.failed;
    // A batch with failed rows was logged as failed; stop so a later empty batch cannot hide it from the health check.
    if (result.failed > 0 || result.erased + result.deleted === 0) break;
  }
  return { erased, deleted, failed, batches };
}

/** The scheduled job: a failed sweep rolls back its own log row, so the failure is recorded here, in a fresh statement. */
export async function runRetentionJob(pool: Queryable, options: { batch?: number; maxBatches?: number } = {}): Promise<RetentionJobOutcome> {
  try {
    const result = await runRetention(pool, options);
    // Rows the sweep could not handle are already recorded as a failed run (row_failed); report the job as failed too.
    return result.failed > 0 ? { ok: false } : { ok: true, ...result };
  }
  catch {
    await pool.query("select public.connect_retention_record_failure($1)", ["sweep_failed"]).catch(() => undefined);
    return { ok: false };
  }
}

export async function retentionHealth(pool: Queryable): Promise<RetentionHealth & { healthy: boolean; windowHours: number }> {
  const { rows: [{ health }] } = await pool.query<{ health: RetentionHealth }>("select public.connect_retention_health() as health");
  return { ...health, healthy: !health.overdue && !health.failedSinceSuccess, windowHours: CONNECT_RETENTION_POLICY.healthWindowHours };
}
