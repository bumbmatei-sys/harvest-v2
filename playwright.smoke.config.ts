import { defineConfig, devices } from "@playwright/test";
import { smokeConfig } from "./tests/smoke/smoke-config";

// Read-only checks against a deployed site. See docs/setup/production-smoke.md.
// Traces, videos and screenshots stay off: they would capture the smoke session cookie.
const config = smokeConfig();
export default defineConfig({
  testDir: "./tests/smoke", fullyParallel: false, workers: 1, retries: 1, timeout: 30_000,
  reporter: [["list"], ["junit", { outputFile: "test-results/smoke/junit.xml" }]],
  use: {
    baseURL: config.baseURL, trace: "off", video: "off", screenshot: "off",
    extraHTTPHeaders: config.bypassSecret ? { "x-vercel-protection-bypass": config.bypassSecret } : {},
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  projects: [
    { name: "api", testMatch: /\.api\.spec\.ts$/ },
    { name: "browser", testMatch: /\.browser\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
  ],
});
