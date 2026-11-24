import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mailbox = process.env.HARVEST_E2E_MAILBOX ?? join(tmpdir(), `harvest-e2e-mailbox-${process.pid}.jsonl`);
process.env.HARVEST_E2E_MAILBOX = mailbox;
const port = process.env.E2E_PORT ?? "3100";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }, baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx tsx scripts/e2e-server.ts", url: `http://127.0.0.1:${port}/sign-in`, timeout: 120_000, reuseExistingServer: false,
    env: { HARVEST_E2E_MAILBOX: mailbox, E2E_PORT: port } },
});
