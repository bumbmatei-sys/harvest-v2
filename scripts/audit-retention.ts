import { createPool } from "../src/db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";

const mode = process.argv[2] ?? "run";
if (process.env.HARVEST_AUDIT_RETENTION_ENABLED === "1" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") &&
    process.env.VERCEL_ENV !== "production" && process.env.HARVEST_ENV !== "production") {
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    pool = createPool(workerDatabaseUrl(process.env));
    await requireWorkerRole(pool);
    if (mode === "check") {
      const { rows: [run] } = await pool.query<{ healthy: boolean }>("select public.audit_retention_health() as healthy");
      if (!run?.healthy) throw new Error("AUDIT_RETENTION_UNHEALTHY");
    } else if (mode === "run") {
      try {
        for (let i = 0; i < 100; i++) {
          const { rows: [run] } = await pool.query<{ result: { audits: number; rightsRequests: number } }>(
            "select public.audit_retention_run(1000, false) as result");
          if (run.result.audits < 1000 && run.result.rightsRequests < 1000) break;
          if (i === 99) throw new Error("AUDIT_RETENTION_BACKLOG");
        }
      } catch (error) {
        await pool.query("select public.audit_retention_run(1, true)");
        throw error;
      }
    } else {
      throw new Error("AUDIT_RETENTION_USAGE");
    }
  } catch {
    console.error("audit_retention_failed");
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
