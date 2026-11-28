import { readWorkerSiteAddresses, type SiteAddressEnvironment } from "../lib/site-address";
import { sharedScope } from "../lib/shared-scope";
import { runtimeConnectionString } from "../db/request";
import type { FileBucket } from "./storage/r2";
import { hasQaSignInBindings, type QaSignInBindings } from "./qa-sign-in-gate";
import { qaPreviewTokenBinding } from "./qa-preview-gate";

export interface WorkerBindings extends QaSignInBindings, SiteAddressEnvironment {
  HARVEST_ENV?: string;
  BETTER_AUTH_SECRET?: string;
  FILE_GRANT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APP_DATABASE_NAME?: string;
  APP_HYPERDRIVE?: { connectionString: string };
  FILES?: FileBucket;
  HARVEST_COMMUNITIES?: string;
  FILES_REQUIRE_SCAN_PRIVATE?: string;
  /** QA-2: accepted on a preview, staging or local Worker only, never production; see qa-preview-gate.ts. */
  QA_PREVIEW_TOKEN?: string;
}

export function readWorkerSettings(env: WorkerBindings) {
  const stage = env.HARVEST_ENV;
  if (stage !== "local" && stage !== "preview" && stage !== "staging" && stage !== "production") throw invalid();
  const { BETTER_AUTH_SECRET, FILE_GRANT_SECRET, APP_HYPERDRIVE, FILES, RESEND_API_KEY, EMAIL_FROM } = env;
  if (!BETTER_AUTH_SECRET || !FILE_GRANT_SECRET || !APP_HYPERDRIVE || !FILES ||
      typeof FILES.get !== "function" || typeof FILES.put !== "function" ||
      !RESEND_API_KEY?.trim() || !EMAIL_FROM?.trim() || !env.APP_DATABASE_NAME ||
      BETTER_AUTH_SECRET.trim().length < 32 || FILE_GRANT_SECRET.trim().length < 32 ||
      BETTER_AUTH_SECRET === FILE_GRANT_SECRET ||
      hasQaSignInBindings(env)) throw invalid();

  let addresses: ReturnType<typeof readWorkerSiteAddresses>;
  try { addresses = readWorkerSiteAddresses(env, stage); } catch { throw invalid(); }
  let qaPreviewToken: string | null;
  try { qaPreviewToken = qaPreviewTokenBinding(stage, env, [BETTER_AUTH_SECRET, FILE_GRANT_SECRET, RESEND_API_KEY]); } catch { throw invalid(); }
  // The binding URL names a generated database; withDb checks APP_DATABASE_NAME against current_database() on every connection.
  try { runtimeConnectionString(APP_HYPERDRIVE.connectionString, "app", "hyperdrive"); } catch { throw invalid(); }

  return {
    stage, addresses, origin: addresses.app, qaPreviewToken, authSecret: BETTER_AUTH_SECRET, grantSecret: FILE_GRANT_SECRET,
    hyperdrive: APP_HYPERDRIVE, databaseName: env.APP_DATABASE_NAME, bucket: FILES, mailKey: RESEND_API_KEY, mailFrom: EMAIL_FROM,
    features: { NODE_ENV: stage === "production" ? "production" : "development", HARVEST_COMMUNITIES: env.HARVEST_COMMUNITIES },
    requirePrivateScan: stage === "production" || (env.FILES_REQUIRE_SCAN_PRIVATE !== undefined && env.FILES_REQUIRE_SCAN_PRIVATE !== "false"),
  };
}
function invalid() { return new Error("WORKER_CONFIGURATION_INVALID"); }

export const workerSettings = sharedScope<ReturnType<typeof readWorkerSettings>>("worker-settings");
