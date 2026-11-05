import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolve } from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
const withNextIntl = createNextIntlPlugin();
export default function config(phase: string): NextConfig { return withNextIntl({
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
}); }
