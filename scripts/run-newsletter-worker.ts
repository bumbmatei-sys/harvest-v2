import { createPool } from "../src/db/pool";
import { FakeNewsletterProvider } from "../src/server/newsletter-campaigns/fake-provider";
import { newsletterWorkerEnabled, runNewsletterWorker } from "../src/server/newsletter-campaigns/worker";
import { workerDatabaseUrl } from "../src/server/worker-role";

if (newsletterWorkerEnabled(process.env, "HARVEST_NEWSLETTER_WORKER_ENABLED")) {
  let pool;
  try {
    pool = createPool(workerDatabaseUrl());
    pool.on("error", () => console.error("newsletter_worker_pool_failed"));
    const result = await runNewsletterWorker(pool, process.env, new FakeNewsletterProvider(), { log: line => console.error(line) });
    console.log(JSON.stringify(result));
    if (result?.errors || result?.unknown || result?.failed) process.exitCode = 1;
  } catch {
    console.error("newsletter_worker_failed");
    process.exitCode = 1;
  } finally {
    await pool?.end().catch(() => { process.exitCode = 1; });
  }
}
