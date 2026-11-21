import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleWorker } from "./bundle-worker";

if (process.env.CI || process.env.CF02_RUN_STAGING !== "1") {
  console.log("SKIP CF-02 staging bundle preparation");
} else {
  const app = process.env.CF02_HYPERDRIVE_APP_ID;
  const worker = process.env.CF02_HYPERDRIVE_WORKER_ID;
  if (!app || !worker || app === worker || ![app, worker].every((id) => /^[0-9a-f]{32}$/.test(id))) {
    throw new Error("Two distinct staging Hyperdrive configuration IDs are required");
  }
  const directory = await mkdtemp(join(tmpdir(), "harvest-cf02-staging-"));
  await bundleWorker(directory);
  await writeFile(join(directory, "wrangler.json"), JSON.stringify({
    name: "harvest-cf02-staging-probe", main: "worker.mjs", compatibility_date: "2026-11-21",
    compatibility_flags: ["nodejs_compat"], no_bundle: true, workers_dev: false, preview_urls: false,
    hyperdrive: [{ binding: "APP_HYPERDRIVE", id: app }, { binding: "WORKER_HYPERDRIVE", id: worker }],
  }, null, 2));
  console.log(directory);
}
