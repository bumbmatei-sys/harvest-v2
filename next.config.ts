import type { NextConfig } from "next";
import { resolve } from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
export default function config(phase: string): NextConfig { return {
  poweredByHeader: false,
  devIndicators: false,
  turbopack: phase === PHASE_DEVELOPMENT_SERVER && process.env.HARVEST_E2E_MOCK_EMAIL === "1"
    ? { resolveAlias: { resend: "./tests/e2e/resend-mock.ts" } } : {},
  webpack(config, { dev }) {
    // Production can never bundle the test mailer. Real app code has no email test bypass.
    if (dev && process.env.HARVEST_E2E_MOCK_EMAIL === "1") {
      config.resolve.alias.resend = resolve("tests/e2e/resend-mock.ts");
    }
    return config;
  },
}; }
