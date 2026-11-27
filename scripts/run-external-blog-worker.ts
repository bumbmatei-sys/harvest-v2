import { createPool } from "../src/db/pool";
import { blogEnabled } from "../src/server/blog-mode";
import { runExternalBlogWorker } from "../src/server/external-blog-worker";
import { FakeProvider } from "../src/server/social/fake-provider";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";

let pool: ReturnType<typeof createPool> | undefined;
try {
  if (!blogEnabled() || process.env.HARVEST_EXTERNAL_BLOG_WORKER !== "test") throw new Error("TEST_MODE_REQUIRED");
  const url = workerDatabaseUrl();
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
  pool = createPool(url);
  pool.on("error", () => console.error("external_blog_worker_pool_failed"));
  await requireWorkerRole(pool);
  const fake = new FakeProvider({ permissive: true });
  const processed = await runExternalBlogWorker(pool, { enabled: true, now: () => new Date(), provider: () => fake });
  console.log(JSON.stringify({ processed }));
} catch {
  console.error("external_blog_worker_failed");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
