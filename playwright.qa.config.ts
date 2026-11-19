import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localQaOrigin, qaWalkthroughOrigin } from "./tests/qa/preview-origin";

const baseURL = qaWalkthroughOrigin(process.env);
const configured = baseURL !== localQaOrigin;
const mailbox = process.env.HARVEST_E2E_MAILBOX ?? join(tmpdir(), `harvest-walkthrough-${process.pid}.jsonl`);
if (!configured) process.env.HARVEST_E2E_MAILBOX = mailbox;

export default defineConfig({
  testDir: "./tests/qa", outputDir: "./test-results/qa", workers: 1, fullyParallel: false,
  retries: configured ? 1 : 0, timeout: 300_000, expect: { timeout: 20_000 }, reporter: "list",
  projects: [{ name: "qa-chromium", use: { ...devices["Desktop Chrome"] } }],
  use: { baseURL, trace: "retain-on-failure", serviceWorkers: "block", actionTimeout: 15_000, navigationTimeout: 45_000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: configured ? undefined : { command: "npx tsx scripts/e2e-server.ts", url: localQaOrigin + "/sign-in",
    timeout: 120_000, reuseExistingServer: false, gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 }, env: { HARVEST_E2E_MAILBOX: mailbox } },
});
