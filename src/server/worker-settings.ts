import { AsyncLocalStorage } from "node:async_hooks";
import { runtimeConnectionString } from "../db/request";
import type { FileBucket } from "./storage/r2";
import { hasQaSignInBindings, type QaSignInBindings } from "./qa-sign-in-gate";

export interface WorkerBindings extends QaSignInBindings {
  HARVEST_ENV?: string;
  HARVEST_PRODUCTION_ORIGIN?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  FILE_GRANT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APP_DATABASE_NAME?: string;
  APP_HYPERDRIVE?: { connectionString: string };
  FILES?: FileBucket;
  HARVEST_COMMUNITIES?: string;
  FILES_REQUIRE_SCAN_PRIVATE?: string;
}

export function readWorkerSettings(env: WorkerBindings) {
  const stage = env.HARVEST_ENV;
  if (stage !== "local" && stage !== "preview" && stage !== "staging" && stage !== "production") throw invalid();
  const { BETTER_AUTH_URL, BETTER_AUTH_SECRET, FILE_GRANT_SECRET, APP_HYPERDRIVE, FILES, RESEND_API_KEY, EMAIL_FROM } = env;
  if (!env.HARVEST_PRODUCTION_ORIGIN || !BETTER_AUTH_URL || !BETTER_AUTH_SECRET || !FILE_GRANT_SECRET || !APP_HYPERDRIVE || !FILES ||
      typeof FILES.get !== "function" || typeof FILES.put !== "function" ||
      !RESEND_API_KEY?.trim() || !EMAIL_FROM?.trim() || !env.APP_DATABASE_NAME ||
      BETTER_AUTH_SECRET.trim().length < 32 || FILE_GRANT_SECRET.trim().length < 32 ||
      BETTER_AUTH_SECRET === FILE_GRANT_SECRET ||
      hasQaSignInBindings(env)) throw invalid();

  const production = canonicalOrigin(env.HARVEST_PRODUCTION_ORIGIN, false);
  const origin = canonicalOrigin(BETTER_AUTH_URL, stage === "local");
  if ((stage === "production") !== (origin === production)) throw invalid();
  const dbUrl = new URL(runtimeConnectionString(APP_HYPERDRIVE.connectionString, "app"));
  if (decodeURIComponent(dbUrl.pathname.slice(1)) !== env.APP_DATABASE_NAME) throw invalid();

  return {
    stage, origin, authSecret: BETTER_AUTH_SECRET, grantSecret: FILE_GRANT_SECRET,
    hyperdrive: APP_HYPERDRIVE, bucket: FILES, mailKey: RESEND_API_KEY, mailFrom: EMAIL_FROM,
    features: { NODE_ENV: stage === "production" ? "production" : "development", HARVEST_COMMUNITIES: env.HARVEST_COMMUNITIES },
    requirePrivateScan: stage === "production" || (env.FILES_REQUIRE_SCAN_PRIVATE !== undefined && env.FILES_REQUIRE_SCAN_PRIVATE !== "false"),
  };
}
function invalid() { return new Error("WORKER_CONFIGURATION_INVALID"); }

function canonicalOrigin(value: string, local: boolean) {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.href === `${url.origin}/` && loopback === local &&
        (url.protocol === "https:" || (local && url.protocol === "http:"))) return url.origin;
  } catch {
    // Invalid URLs can contain credentials. Never return their parsing error.
  }
  throw invalid();
}
export const workerSettings = new AsyncLocalStorage<ReturnType<typeof readWorkerSettings>>();
