import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  webpack(config, { dev }) {
    // Production can never bundle the test mailer. Real app code has no email test bypass.
    if (dev && process.env.HARVEST_E2E_MOCK_EMAIL === "1") {
      config.resolve.alias.resend = resolve("tests/e2e/resend-mock.ts");
    }
    return config;
  },
};
export default config;
