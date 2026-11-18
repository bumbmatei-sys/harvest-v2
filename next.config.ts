import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolve } from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { isQaPreviewEnvironment, qaSignInMode } from "./src/server/qa-sign-in-gate";

const withNextIntl = createNextIntlPlugin();
const otpModule = "@/server/auth-otp-hooks";
const previewOtpModule = "./src/server/auth-otp-hooks-preview.ts";

export default function config(phase: string): NextConfig {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const aliasQaOtp = isQaPreviewEnvironment(process.env) || (development && qaSignInMode(process.env) === "local");
  const aliasE2eMailer = development && process.env.HARVEST_E2E_MOCK_EMAIL === "1";
  return withNextIntl({
    poweredByHeader: false,
    devIndicators: false,
    turbopack: { resolveAlias: {
      ...(aliasQaOtp ? { [otpModule]: previewOtpModule } : {}),
      ...(aliasE2eMailer ? { resend: "./tests/e2e/resend-mock.ts" } : {}),
    } },
    webpack(config) {
      // Keep the test mailer and derived OTP implementation out of production bundles.
      if (aliasE2eMailer) config.resolve.alias.resend = resolve("tests/e2e/resend-mock.ts");
      if (aliasQaOtp) config.resolve.alias[`${otpModule}$`] = resolve(previewOtpModule);
      return config;
    },
  });
}
