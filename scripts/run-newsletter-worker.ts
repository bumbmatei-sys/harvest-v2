import { createPool } from "../src/db/pool";
import { FakeNewsletterProvider } from "../src/server/newsletter-campaigns/fake-provider";
import { purgeNewsletterDeliveries, recheckNewsletterDomains, snapshotNewsletterAudience } from "../src/server/newsletter-campaigns/maintenance";
import { newsletterWorkerEnabled, runNewsletterWorker } from "../src/server/newsletter-campaigns/worker";
import { checkNewsletterSuppressionStartup } from "../src/server/newsletter-campaigns/suppression-keys";
import { automationsWorkerFlag, runNewsletterAutomations } from "../src/server/newsletter-automations-worker";
import { workerDatabaseUrl } from "../src/server/worker-role";

const action = process.argv[2] ?? "deliver";
const flags = new Map([
  ["deliver", "HARVEST_NEWSLETTER_WORKER_ENABLED"],
  ["recheck-domains", "HARVEST_NEWSLETTER_DOMAIN_RECHECK_ENABLED"],
  ["purge", "HARVEST_NEWSLETTER_RETENTION_ENABLED"],
  ["audience-snapshot", "HARVEST_NEWSLETTER_RETENTION_ENABLED"],
  ["automations", automationsWorkerFlag],
]);
const flag = flags.get(action);
if (action === "check-suppression") {
  try { checkNewsletterSuppressionStartup("worker"); }
  catch { process.exitCode = 1; }
} else if (!flag) {
  throw new Error("UNKNOWN_NEWSLETTER_WORKER_ACTION");
} else if (newsletterWorkerEnabled(process.env, flag)) {
  let pool;
  try {
    checkNewsletterSuppressionStartup("worker");
    pool = createPool(workerDatabaseUrl());
    pool.on("error", () => console.error("newsletter_worker_pool_failed"));
    const provider = new FakeNewsletterProvider();
    if (action === "purge") console.log(JSON.stringify(await purgeNewsletterDeliveries(pool, process.env)));
    else if (action === "audience-snapshot") console.log(JSON.stringify(await snapshotNewsletterAudience(pool, process.env)));
    else if (action === "recheck-domains") console.log(JSON.stringify(await recheckNewsletterDomains(pool, process.env, provider)));
    else if (action === "automations") console.log(JSON.stringify(await runNewsletterAutomations(pool, process.env, provider)));
    else {
      const result = await runNewsletterWorker(pool, process.env, provider, { log: line => console.error(line) });
      console.log(JSON.stringify(result));
      if (result?.errors || result?.unknown || result?.operatorReview || result?.failed) process.exitCode = 1;
    }
  } catch {
    console.error("newsletter_worker_failed");
    process.exitCode = 1;
  } finally {
    await pool?.end().catch(() => { process.exitCode = 1; });
  }
}
