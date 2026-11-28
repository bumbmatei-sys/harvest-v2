import { readSiteAddresses } from "../lib/site-address";
import { hasQaSignInBindings } from "./qa-sign-in-gate";
import { qaDatabaseAllowed } from "./qa-database-allowlist";

// QA-1 and QA-2 on the Cloudflare app: the only module that reads the preview token binding and decides where the
// fake-data seed may write. Pure functions of their arguments; no request header is ever consulted.
type Env = Readonly<Record<string, string | undefined>>;

/** Seeded and shortcut accounts: a reserved, undeliverable domain only (RFC 2606). */
export const qaSyntheticEmail = (email: string) => /^[a-z0-9][a-z0-9._+-]{0,63}@example\.invalid$/.test(email);

/** Accounts a seed target may already hold: the seed's own domain plus the earlier synthetic fixture domains. */
export const qaAcceptedUserDomains = ["example.invalid", "qa.harvest.invalid", "example.test"] as const;

export type QaSeedStage = "test" | "preview" | "staging";
type SeedDatabase = { stage: Exclude<QaSeedStage, "test">; host: string; database: string; note: string };

/**
 * Remote endpoints the seed may write to, recorded by host and database name. Nothing else passes, so a production,
 * dev or unknown endpoint is refused even with a non-production HARVEST_ENV. Add an entry only in a reviewed change.
 */
export const qaSeedDatabases: readonly SeedDatabase[] = [
  { stage: "preview", host: "ep-misty-pond-ba96mdcl.c-8.eu-central-1.aws.neon.tech", database: "harvest", note: "Neon vercel-preview branch (br-shy-hall-baslhh18)" },
  { stage: "staging", host: "ep-royal-firefly-ba0hg29h.c-8.eu-central-1.aws.neon.tech", database: "harvest", note: "Neon cf-staging branch, direct endpoint (founder, 26 Nov)" },
];

const loopback = ["localhost", "127.0.0.1", "[::1]"];

/** Throws QA_SEED_* unless HARVEST_ENV is a non-production QA stage and DATABASE_URL is an allowed harvest_app target. */
export function qaSeedTarget(env: Env, allowlist: readonly SeedDatabase[] = qaSeedDatabases): { stage: QaSeedStage; url: string } {
  const stage = env.HARVEST_ENV;
  if (stage !== "test" && stage !== "preview" && stage !== "staging") throw new Error("QA_SEED_ENV_REFUSED");
  if ([env.NODE_ENV, env.VERCEL_ENV, env.VERCEL_TARGET_ENV].includes("production")) throw new Error("QA_SEED_ENV_REFUSED");
  const value = env.DATABASE_URL;
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("QA_SEED_TARGET_REFUSED"); }
  const params = [...url.searchParams.keys()];
  const shaped = ["postgres:", "postgresql:"].includes(url.protocol) && !url.hash &&
    params.every((key) => key === "sslmode" || key === "channel_binding") && url.username === "harvest_app";
  if (!shaped) throw new Error("QA_SEED_TARGET_REFUSED");
  if (stage === "test") {
    if (!loopback.includes(url.hostname) || !/^\/harvest_test(?:_[a-z0-9]+)*$/.test(url.pathname)) throw new Error("QA_SEED_TARGET_REFUSED");
  } else if ((url.port && url.port !== "5432") ||
      !allowlist.some((item) => item.stage === stage && item.host === url.hostname && url.pathname === `/${item.database}`)) {
    throw new Error("QA_SEED_TARGET_REFUSED");
  }
  return { stage, url: value! };
}

const TOKEN_MIN = 32;
/** Worker stages where the test sign-in shortcut may run. Never production. */
export const qaShortcutStages: readonly string[] = ["preview", "staging", "local"];

/**
 * The QA_PREVIEW_TOKEN Worker binding. Absent is normal. Present, it is accepted only on a preview, staging (founder
 * decision, 26 Nov) or local Worker and must be long and distinct from every other secret; on production the Worker refuses to start.
 */
export function qaPreviewTokenBinding(stage: string, env: { QA_PREVIEW_TOKEN?: string }, otherSecrets: readonly (string | undefined)[]): string | null {
  const token = env.QA_PREVIEW_TOKEN;
  if (token === undefined) return null;
  if (!qaShortcutStages.includes(stage) || token.trim().length < TOKEN_MIN || otherSecrets.includes(token)) {
    throw new Error("QA_PREVIEW_TOKEN_REFUSED");
  }
  return token;
}

/** The Node server (next dev for browser tests): HARVEST_ENV=test, a loopback origin and a local harvest_test database only. */
export function qaShortcutNodeAccess(env: Env): { token: string; origin: string } | null {
  if (env.HARVEST_ENV !== "test" || env.NODE_ENV === "production" || env.VERCEL_ENV !== undefined || env.VERCEL_TARGET_ENV !== undefined) return null;
  // The Vercel preview OTP alias would replace the hooks this shortcut relies on; never run both.
  if (hasQaSignInBindings(env) || !qaDatabaseAllowed(env.DATABASE_URL, "local")) return null;
  const token = env.QA_PREVIEW_TOKEN;
  if (!token || token.trim().length < TOKEN_MIN || token === env.BETTER_AUTH_SECRET) return null;
  let origin: URL;
  try { origin = new URL(readSiteAddresses(env).app); } catch { return null; }
  if (!loopback.includes(origin.hostname) || !["http:", "https:"].includes(origin.protocol)) return null;
  return { token, origin: origin.origin };
}
