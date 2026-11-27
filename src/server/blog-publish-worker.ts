import type { Pool } from "pg";
import type { createPool } from "../db/pool";
import { blogPublishWorkerEnabled } from "./blog-mode";
import { requireWorkerRole, workerDatabaseUrl } from "./worker-role";

const batchSize = 50;

/** One pass of the scheduled-publish job: the database function publishes up to 50 due articles as the worker role. Sends nothing anywhere. */
export async function sweepBlogSchedule(pool: Pool): Promise<{ published: number }> {
  const { rows: [row] } = await pool.query<{ published: number }>("select public.blog_publish_due($1) as published", [batchSize]);
  if (!Number.isInteger(row?.published) || row.published < 0 || row.published > batchSize) throw new Error("BLOG_PUBLISH_INVALID_RESULT");
  return { published: row.published };
}

/** The job's entry point (scripts/blog-publish.ts): off unless HARVEST_BLOG_PUBLISH_ENABLED=1 outside production; the worker login only. */
export async function runBlogPublishWorker(mode: string, env: Record<string, string | undefined>, openPool: typeof createPool,
  output: { log(line: string): void; error(line: string): void }): Promise<number> {
  if (!blogPublishWorkerEnabled(env)) return 0;
  let pool: Pool | undefined;
  const alert = () => output.error(JSON.stringify({ event: "blog_publish_alert", reason: "failed" }));
  try {
    if (mode !== "run") throw new Error("BLOG_PUBLISH_USAGE");
    pool = openPool(workerDatabaseUrl(env));
    pool.on("error", alert);
    await requireWorkerRole(pool);
    let published = 0;
    // Drain in batches, bounded, so a backlog after downtime is cleared in one run.
    for (let round = 0; round < 20; round++) {
      const outcome = await sweepBlogSchedule(pool);
      published += outcome.published;
      if (outcome.published < batchSize) break;
    }
    output.log(JSON.stringify({ published }));
    return 0;
  } catch {
    alert();
    return 1;
  } finally {
    await pool?.end().catch(alert);
  }
}
