import type { Pool } from "pg";
import type { createPool } from "../db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "./worker-role";

const rules = [
  "connect_responses", "connect_tombstones", "hosted_form_responses", "verified_contact_review", "closed_followup_cases",
  "newsletter_deliveries", "newsletter_clicks", "newsletter_automation_clicks",
  "community_applications", "community_channel_messages", "community_direct_messages", "audit_logs", "retention_run_logs",
] as const;

export type RetentionAlert = { rule: string; reason: "failed" | "stale"; errorCode: string | null };
export type RetentionAlertSender = (alert: RetentionAlert) => Promise<void>;
type HealthRow = { rule_name: string; last_run_at: Date | null; error_code: string | null; stale: boolean; alert_claimed: boolean };
type Outcome = { rule: string; durationMs: number; deleted: number; anonymised: number; flagged: number; errorCode: string | null };

export function retentionJobsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.RETENTION_JOBS_ENABLED === "1";
}

export async function checkRetentionRules(pool: Pick<Pool, "query">, sendAlert?: RetentionAlertSender) {
  const { rows } = await pool.query<HealthRow>("select * from public.retention_job_health($1)", [Boolean(sendAlert)]);
  let alertFailed = false;
  for (const row of rows) {
    if (!row.alert_claimed || !sendAlert) continue;
    try {
      await sendAlert({ rule: row.rule_name, reason: row.error_code ? "failed" : "stale", errorCode: row.error_code });
    } catch {
      // Claim before invoking the hook so overlapping monitors and retries cannot send a second alert.
      alertFailed = true;
    }
  }
  const health = rows.map(row => ({
    rule: row.rule_name, lastRunAt: row.last_run_at, errorCode: row.error_code, stale: row.stale,
    healthy: !row.stale && row.error_code === null,
  }));
  return { healthy: health.every(rule => rule.healthy), alertFailed, rules: health };
}

export async function runRetentionRules(pool: Pick<Pool, "query">) {
  const outcomes: Outcome[] = [];
  for (const rule of rules) {
    const started = performance.now();
    try {
      const { rows: [{ outcome }] } = await pool.query<{ outcome: Outcome }>("select public.retention_run_rule($1) as outcome", [rule]);
      outcomes.push(outcome);
    } catch {
      // Record a statement failure in a separate transaction, then continue with the other rules.
      await pool.query("select public.retention_run_rule($1, true)", [rule]).catch(() => undefined);
      outcomes.push({ rule, durationMs: Math.round(performance.now() - started), deleted: 0, anonymised: 0, flagged: 0, errorCode: "database_error" });
    }
  }
  return outcomes;
}

export async function runRetentionWorker(
  mode: string, env: NodeJS.ProcessEnv, openPool: typeof createPool,
  output: Pick<Console, "log" | "error">, sendAlert?: RetentionAlertSender,
): Promise<number> {
  // Both the sweep and the monitor are off until deliberately enabled, including in production.
  if (!retentionJobsEnabled(env)) return 0;
  let pool: Pool | undefined;
  try {
    if (mode !== "run" && mode !== "check") throw new Error("RETENTION_USAGE");
    pool = openPool(workerDatabaseUrl(env));
    pool.on("error", () => output.error("retention_pool_failed"));
    await requireWorkerRole(pool);
    const runs = mode === "run" ? await runRetentionRules(pool) : [];
    const health = await checkRetentionRules(pool, sendAlert);
    output.log(JSON.stringify({ runs, ...health }));
    return health.healthy && !health.alertFailed && !runs.some(run => run.errorCode) ? 0 : 1;
  } catch {
    output.error("retention_jobs_failed");
    return 1;
  } finally {
    await pool?.end().catch(() => output.error("retention_pool_close_failed"));
  }
}
