import { readFile, writeFile } from "node:fs/promises";

// CF-08 (prepared, not activated): writes the Wrangler config for the PRODUCTION Worker from cloudflare/production.json
// (IDs and names only, no secrets), and the config for deploying the pre-built bundle. Mirrors
// tests/cf07/prepare-staging.ts, but fails closed: it refuses the committed placeholders, anything that names or equals a
// staging resource, a workers.dev origin, a test-only mailbox or alias, and a staging.json whose production guards do not
// name the same production origin and Hyperdrive. Secrets (BETTER_AUTH_SECRET, FILE_GRANT_SECRET, RESEND_API_KEY) are set
// on the Worker by the founder, never here. Nothing runs unless CF08_PREPARE_PRODUCTION=1, and in CI only inside the
// production workflow (CF08_DEPLOY_JOB=1).
type Settings = Record<string, unknown>;

export const PLACEMENT_REGION = "aws:eu-central-1";

function read(settings: Settings, name: string, pattern: RegExp) {
  const value = settings[name];
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid or missing production setting ${name}`);
  return value;
}

const reservedHost = /(?:^|\.)(?:invalid|test|example|localhost|local)$|(?:^|\.)example\.(?:com|net|org)$|\.workers\.dev$|staging/;

export function productionConfig(production: Settings, staging: Settings) {
  const name = read(production, "CF08_PRODUCTION_WORKER", /^[a-z0-9][a-z0-9-]{2,62}$/);
  if (name.includes("staging") || name === staging.CF07_STAGING_WORKER || name === staging.CF07_STAGING_MAILBOX_SERVICE) {
    throw new Error("The production Worker needs its own name");
  }
  const origin = read(production, "CF08_PRODUCTION_ORIGIN", /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
  if (reservedHost.test(new URL(origin).hostname) || origin === staging.CF07_STAGING_ORIGIN) {
    throw new Error("Set CF08_PRODUCTION_ORIGIN to the real production origin (placeholder, test, workers.dev or staging origin refused)");
  }
  const hyperdrive = read(production, "CF08_PRODUCTION_HYPERDRIVE_ID", /^[a-f0-9]{32}$/);
  if (/^0+$/.test(hyperdrive) || hyperdrive === staging.CF07_STAGING_HYPERDRIVE_ID) {
    throw new Error("Set CF08_PRODUCTION_HYPERDRIVE_ID to the production Hyperdrive (placeholder or staging Hyperdrive refused)");
  }
  // The staging guards compare against these values; they must name the real production resources too.
  if (staging.CF07_PRODUCTION_ORIGIN !== origin || staging.CF07_PRODUCTION_HYPERDRIVE_ID !== hyperdrive) {
    throw new Error("cloudflare/staging.json must name the same production origin and Hyperdrive");
  }
  const bucket = read(production, "CF08_PRODUCTION_BUCKET", /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
  if (bucket.includes("staging") || bucket === staging.CF07_STAGING_BUCKET) throw new Error("The production Worker needs its own bucket");
  const from = read(production, "CF08_PRODUCTION_EMAIL_FROM", /^[^\n<>@]*<?[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}>?$/i);
  const fromHost = /@([a-z0-9.-]+)>?$/i.exec(from)?.[1]?.toLowerCase() ?? "";
  if (reservedHost.test(fromHost)) throw new Error("Set CF08_PRODUCTION_EMAIL_FROM to the verified production sender");
  return {
    name, main: "app-worker.mjs", compatibility_date: "2026-11-19",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    // Reachable only on the production custom domain, which the founder attaches at cut-over (no routes here, so a
    // deploy never touches DNS). The app answers 421 on any other origin.
    workers_dev: false, preview_urls: false,
    assets: { binding: "ASSETS", directory: "../.open-next/assets", html_handling: "none" },
    // No `resend` alias and no MAILBOX service: production uses the real email provider.
    alias: { "server-only": "./server-only.mjs" },
    vars: {
      HARVEST_ENV: "production", BETTER_AUTH_URL: origin, HARVEST_PRODUCTION_ORIGIN: origin,
      APP_DATABASE_NAME: read(production, "CF08_PRODUCTION_DATABASE", /^[a-zA-Z0-9_-]+$/), EMAIL_FROM: from,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    hyperdrive: [{ binding: "APP_HYPERDRIVE", id: hyperdrive }],
    r2_buckets: [{ binding: "FILES", bucket_name: bucket }],
    observability: { enabled: true },
    upload_source_maps: false,
    minify: true,
    // Next to the Neon database (aws-eu-central-1); see the staging load profile in docs/setup/cloudflare-staging.md.
    placement: { region: PLACEMENT_REGION },
  };
}

/** The config for deploying the bundle that `wrangler deploy --dry-run --outdir` produced in the secret-free build job. */
export function bundledConfig(config: ReturnType<typeof productionConfig>) {
  const rest: Partial<typeof config> = { ...config };
  delete rest.alias; delete rest.minify;
  return { ...rest, main: "app-worker.js", no_bundle: true, assets: { ...config.assets, directory: "./assets" } };
}

async function json(path: string) { return JSON.parse(await readFile(path, "utf8")) as Settings; }

if (process.env.CF08_PREPARE_PRODUCTION === "1" && (!process.env.CI || process.env.CF08_DEPLOY_JOB === "1")) {
  const config = productionConfig(await json("cloudflare/production.json"), await json("cloudflare/staging.json"));
  const bundledDirectory = process.argv[2] === "--bundled" ? process.argv[3] : undefined;
  if (bundledDirectory) {
    await writeFile(`${bundledDirectory}/wrangler.json`, `${JSON.stringify(bundledConfig(config), null, 2)}\n`);
    console.log(`${bundledDirectory}/wrangler.json`);
  } else {
    await writeFile("cloudflare/wrangler.production.json", `${JSON.stringify(config, null, 2)}\n`);
    console.log("cloudflare/wrangler.production.json");
  }
} else {
  console.log("CF-08 production preparation skipped");
}
