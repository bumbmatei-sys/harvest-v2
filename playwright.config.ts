import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mailbox = process.env.HARVEST_E2E_MAILBOX ?? join(tmpdir(), `harvest-e2e-mailbox-${process.pid}.jsonl`);
process.env.HARVEST_E2E_MAILBOX = mailbox;
const productionBuild = process.env.E2E_SERVER === "production";
const port = process.env.E2E_PORT ?? "3100";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  // The dev server compiles each route on its first request; a slower runner needs more than the 5 s default before an assertion is judged.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }, baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx tsx scripts/e2e-server.ts", url: `http://127.0.0.1:${port}/sign-in`, timeout: productionBuild ? 900_000 : 120_000, reuseExistingServer: false, stdout: "pipe", gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    env: { HARVEST_E2E_MAILBOX: mailbox, E2E_PORT: port } },
});
