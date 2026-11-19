import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const local = "http://127.0.0.1:3100";
const configured = process.env.QA_PREVIEW_URL;
if (process.env.CI && !configured) throw new Error("QA preview URL is required in CI.");
const raw = configured ? new URL(configured) : new URL(local);
if (raw.username || raw.password || raw.pathname !== "/" || raw.search || raw.hash ||
    (configured && raw.protocol !== "https:")) throw new Error("Use a bare HTTPS preview origin.");
const mailbox = process.env.HARVEST_E2E_MAILBOX ?? join(tmpdir(), `harvest-walkthrough-${process.pid}.jsonl`);
if (!configured) process.env.HARVEST_E2E_MAILBOX = mailbox;

export default defineConfig({
  testDir: "./tests/qa", outputDir: "./test-results/qa", workers: 1, fullyParallel: false,
  retries: configured ? 1 : 0, timeout: 240_000, reporter: "list",
  projects: [{ name: "qa-chromium", use: { ...devices["Desktop Chrome"] } }],
  use: { baseURL: raw.origin, trace: "retain-on-failure", serviceWorkers: "block",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: configured ? undefined : { command: "npx tsx scripts/e2e-server.ts", url: local + "/sign-in",
    timeout: 120_000, reuseExistingServer: false, env: { HARVEST_E2E_MAILBOX: mailbox } },
});
