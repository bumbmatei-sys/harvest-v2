import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCf03 } from "./bundle";

function setting(name: string, pattern: RegExp) {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`Invalid or missing staging setting ${name}`);
  return value;
}

if (process.env.CF03_PREPARE_STAGING === "1" && !process.env.CI) {
  const origin = setting("CF03_STAGING_ORIGIN", /^https:\/\/[a-z0-9.-]+$/);
  const production = setting("CF03_PRODUCTION_ORIGIN", /^https:\/\/[a-z0-9.-]+$/);
  if (origin === production) throw new Error("The test Worker needs an isolated staging origin");
  const database = setting("CF03_STAGING_DATABASE", /^[a-zA-Z0-9_-]+$/);
  const id = setting("CF03_STAGING_HYPERDRIVE_ID", /^[a-f0-9]{32}$/);
  const bucket = setting("CF03_STAGING_BUCKET", /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
  const mailbox = setting("CF03_STAGING_MAILBOX_SERVICE", /^[a-z0-9][a-z0-9-]+$/);
  const directory = await mkdtemp(join(tmpdir(), "harvest-cf03-staging-"));
  try {
    await bundleCf03(directory);
    await writeFile(join(directory, "wrangler.json"), JSON.stringify({
      name: "harvest-cf03-staging-fixture",
      main: "worker.mjs",
      compatibility_date: "2026-11-19",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      vars: {
        HARVEST_ENV: "staging", BETTER_AUTH_URL: origin, HARVEST_PRODUCTION_ORIGIN: production,
        APP_DATABASE_NAME: database, EMAIL_FROM: "fixture@example.invalid",
      },
      hyperdrive: [{ binding: "APP_HYPERDRIVE", id }],
      r2_buckets: [{ binding: "FILES", bucket_name: bucket }],
      services: [{ binding: "MAILBOX", service: mailbox }],
    }, null, 2));
    console.log(directory);
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error("Could not prepare the staging test bundle");
  }
} else {
  console.log("CF-03 staging preparation skipped");
}
