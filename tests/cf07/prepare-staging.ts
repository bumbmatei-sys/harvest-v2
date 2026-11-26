import { writeFile } from "node:fs/promises";

// CF-07b: writes cloudflare/wrangler.staging.json (gitignored) for the whole-app staging Worker. It references the
// disposable staging resources by ID only and holds no secrets; deploy it with Wrangler after the OpenNext build and
// `scripts/cf-patch-opennext.mjs`, then inject BETTER_AUTH_SECRET, FILE_GRANT_SECRET and RESEND_API_KEY as Worker
// secrets. The CF-03 harness (tests/cf03/harness-worker.ts) serves the MAILBOX binding through its Mailbox entrypoint.
// Skips by default and in CI.
function setting(name: string, pattern: RegExp) {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`Invalid or missing staging setting ${name}`);
  return value;
}

// The deploy workflow (.github/workflows/cf-staging.yml) sets CF07_DEPLOY_JOB=1; ordinary CI never prepares a deploy.
if (process.env.CF07_PREPARE_STAGING === "1" && (!process.env.CI || process.env.CF07_DEPLOY_JOB === "1")) {
  const name = setting("CF07_STAGING_WORKER", /^[a-z0-9][a-z0-9-]{2,62}$/);
  const origin = setting("CF07_STAGING_ORIGIN", /^https:\/\/[a-z0-9.-]+$/);
  const production = setting("CF07_PRODUCTION_ORIGIN", /^https:\/\/[a-z0-9.-]+$/);
  if (origin === production) throw new Error("The staging Worker needs an isolated origin");
  const hyperdrive = setting("CF07_STAGING_HYPERDRIVE_ID", /^[a-f0-9]{32}$/);
  if (hyperdrive === setting("CF07_PRODUCTION_HYPERDRIVE_ID", /^[a-f0-9]{32}$/)) throw new Error("The staging Worker needs an isolated Hyperdrive");
  const config = {
    name, main: "app-worker.mjs", compatibility_date: "2026-11-19",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    // Public on workers.dev only when explicitly requested for a hosted run; otherwise unreachable.
    workers_dev: process.env.CF07_STAGING_WORKERS_DEV === "1", preview_urls: false,
    // CF07_STAGING_SKIP_ASSETS=1 deploys without static assets for an operator whose proxy rewrites Authorization (the
    // asset upload uses its own session token). Rendered pages still run; static files and the manifest are then absent.
    ...(process.env.CF07_STAGING_SKIP_ASSETS === "1" ? {} : { assets: { binding: "ASSETS", directory: "../.open-next/assets", html_handling: "none" } }),
    alias: { resend: "../tests/cf07/resend-mailbox.mjs", "server-only": "./server-only.mjs" },
    vars: {
      HARVEST_ENV: "staging", BETTER_AUTH_URL: origin, HARVEST_PRODUCTION_ORIGIN: production,
      APP_DATABASE_NAME: setting("CF07_STAGING_DATABASE", /^[a-zA-Z0-9_-]+$/), EMAIL_FROM: "fixture@example.invalid",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    hyperdrive: [{ binding: "APP_HYPERDRIVE", id: hyperdrive }],
    r2_buckets: [{ binding: "FILES", bucket_name: setting("CF07_STAGING_BUCKET", /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/) }],
    services: [{ binding: "MAILBOX", service: setting("CF07_STAGING_MAILBOX_SERVICE", /^[a-z0-9][a-z0-9-]+$/), entrypoint: "Mailbox" }],
    observability: { enabled: true },
    // The OpenNext bundle's source maps are about 62 MiB, above the 60 MiB upload limit (error 10021).
    upload_source_maps: false,
    // Minified, the bundle starts in about 620 ms on Cloudflare instead of failing the 1 s startup limit (26 Nov).
    minify: true,
  };
  await writeFile("cloudflare/wrangler.staging.json", `${JSON.stringify(config, null, 2)}\n`);
  console.log("cloudflare/wrangler.staging.json");
} else {
  console.log("CF-07 staging preparation skipped");
}
