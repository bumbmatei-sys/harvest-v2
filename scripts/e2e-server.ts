import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { testDatabase } from "../tests/database";
import { storageMock } from "../tests/storage-mock";
const database = await testDatabase();
const storage = await storageMock();
// Browser tests may simulate a slow database (for loading states) on this disposable DB only.
if (process.env.HARVEST_E2E_MAILBOX) await writeFile(`${process.env.HARVEST_E2E_MAILBOX}.database`, database.appURL, { mode: 0o600 });
// Browser specs that must seed rows the app role cannot write (for example Events placements) read this privileged URL; it never leaves the disposable database.
if (process.env.HARVEST_E2E_MAILBOX) await writeFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, database.admin.options.connectionString ?? "", { mode: 0o600 });
const connectKey=randomBytes(32).toString("hex");
if(process.env.HARVEST_E2E_MAILBOX)await writeFile(`${process.env.HARVEST_E2E_MAILBOX}.connect-worker`,JSON.stringify({DATABASE_URL:database.appURL,HARVEST_CONNECT_TEST_KEY:connectKey}),{mode:0o600});
// QA-2: the test sign-in shortcut is open on this local test server only (HARVEST_ENV=test, loopback origin, harvest_test database).
const qaPreviewToken = randomBytes(32).toString("hex");
if (process.env.HARVEST_E2E_MAILBOX) await writeFile(`${process.env.HARVEST_E2E_MAILBOX}.qa-token`, qaPreviewToken, { mode: 0o600 });
const formsKey=randomBytes(32).toString("hex");
// Newsletter click-link specs sign a synthetic redirect token with the dev server's newsletter token key; the file never leaves this machine.
const newsletterTokenKey = randomBytes(32).toString("hex");
if (process.env.HARVEST_E2E_MAILBOX) await writeFile(`${process.env.HARVEST_E2E_MAILBOX}.newsletter-key`, newsletterTokenKey, { mode: 0o600 });
const bioKey=randomBytes(32).toString("hex");
// Another port can be used when 3100 is busy: E2E_PORT here and in playwright.config.ts (the default stays 3100).
const port = process.env.E2E_PORT ?? "3100";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", process.env.E2E_WEBPACK ? "--webpack" : "--turbopack", "--hostname", "127.0.0.1", "--port", port], {
  stdio: ["ignore", "inherit", "inherit"], env: { ...process.env,
    // Override any real credentials and avoid reading live .env.local during browser tests.
    HARVEST_CONNECT_INTAKE: "synthetic", HARVEST_CONNECT_TEST_KEY: connectKey,
    // Hosted CRM forms run in synthetic mode only against this disposable harvest_test database; production stays hard-off in code.
    HARVEST_CRM_FORMS: "synthetic", HARVEST_CRM_FORMS_TEST_KEY: formsKey,
    // Link in bio "Message me": synthetic mode against this disposable database only; nothing is ever sent.
    HARVEST_LINK_IN_BIO_MESSAGES: "synthetic", HARVEST_LINK_IN_BIO_MESSAGES_TEST_KEY: bioKey,
    HARVEST_ENV: "test", QA_PREVIEW_TOKEN: qaPreviewToken,
    DATABASE_URL: database.appURL, DATABASE_URL_UNPOOLED: "", BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`, RESEND_API_KEY: "re_e2e_mock_only", EMAIL_FROM: "Harvest <test@example.test>",
    // Hosted newsletter sign-ups sign their confirmation links with this key; the message goes to the in-memory fake sink only.
    HARVEST_NEWSLETTER_TOKEN_KEY: newsletterTokenKey,
    HARVEST_NEWSLETTER_SUPPRESSION_KEYS: JSON.stringify([randomBytes(32).toString("hex")]),
    HARVEST_E2E_MOCK_EMAIL: "1", NEXT_TELEMETRY_DISABLED: "1",
    // The dev server compiles routes on demand and holds them in memory for the whole run; give it room so a long shard is not killed or starved (ECONNRESET, "destination stream errored").
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=3072`.trim(),
    FILES_REQUIRE_SCAN_PRIVATE: "false",
    // Newsletter automations are hard-off by default; the browser tests turn them on (entering and stopping only; nothing is sent).
    HARVEST_NEWSLETTER_AUTOMATIONS: "1",
    S3_ENDPOINT: storage.config.endpoint, S3_BUCKET: storage.config.bucket, S3_REGION: storage.config.region,
    S3_ACCESS_KEY_ID: storage.config.accessKeyId, S3_SECRET_ACCESS_KEY: storage.config.secretAccessKey,
  },
});
let stopping = false;
// Best-effort warm-up: the first request to a route compiles it, which on a busy runner can exceed a test's patience. Compile the common public and API routes once, before the first spec.
void (async () => {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/sign-in`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 1000)); }
  for (const path of ["/sign-in", "/workspaces", "/api/workspaces", "/l/warm-up", "/f/warm-up", "/subscribe/warm-up", "/communities/warm-up", "/discover"]) {
    try { await fetch(`${base}${path}`, { redirect: "manual" }); } catch { /* warm-up only */ }
  }
})();
async function stop() {
  if (stopping) return; stopping = true;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await storage.close(); await database.close(); process.exit(0);
}
process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
child.once("exit", () => { if (!stopping) void Promise.all([storage.close(), database.close()]).finally(() => process.exit(1)); });
