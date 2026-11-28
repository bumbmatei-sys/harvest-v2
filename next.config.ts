import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolve } from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { qaDatabaseAllowed } from "./src/server/qa-database-allowlist";
import { isQaPreviewEnvironment, qaSignInMode } from "./src/server/qa-sign-in-gate";

const withNextIntl = createNextIntlPlugin();
const otpModule = "@/server/auth-otp-hooks";
const previewOtpModule = "./src/server/auth-otp-hooks-preview.ts";

export default function config(phase: string): NextConfig {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const aliasQaOtp = isQaPreviewEnvironment(process.env) || (development && qaSignInMode(process.env) === "local");
  const localE2eBuild = process.env.E2E_SERVER === "production" && process.env.NODE_ENV === "test" &&
    process.env.HARVEST_ENV === "test" && process.env.VERCEL_ENV === undefined && process.env.VERCEL_TARGET_ENV === undefined &&
    qaDatabaseAllowed(process.env.DATABASE_URL, "local");
  const aliasE2eMailer = (development || localE2eBuild) && process.env.HARVEST_E2E_MOCK_EMAIL === "1";
  return withNextIntl({
    ...(localE2eBuild ? { distDir: ".next/e2e" } : {}),
    poweredByHeader: false,
    devIndicators: false,
    // Vercel builds ran out of memory from #220 on: the in-build type check peaks while webpack's memory is still held.
    // The required GitHub Actions `typecheck` job runs the same tsc on every PR head, so skip only the duplicate on Vercel.
    // The browser shards also have a separate required typecheck job for the same source.
    typescript: { ignoreBuildErrors: process.env.VERCEL === "1" || localE2eBuild },
    turbopack: { resolveAlias: {
      ...(aliasQaOtp ? { [otpModule]: previewOtpModule } : {}),
      ...(aliasE2eMailer ? { resend: "./tests/e2e/resend-mock.ts" } : {}),
    } },
    webpack(config, { webpack }) {
      // Only the dedicated local E2E build includes the fake mailer among optimized builds.
      if (aliasE2eMailer) config.resolve.alias.resend = resolve("tests/e2e/resend-mock.ts");
      if (aliasQaOtp) {
        // Replace the request before the tsconfig paths plugin can resolve the default implementation.
        config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^@\/server\/auth-otp-hooks$/, resolve(previewOtpModule)));
      }
      return config;
    },
  });
}
