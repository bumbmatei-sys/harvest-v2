import { qaDatabaseAllowed } from "./qa-database-allowlist";

type Env = Readonly<Record<string, string | undefined>>;

export function isQaPreviewEnvironment(env: Env) {
  return env.VERCEL_ENV === "preview" && env.VERCEL_TARGET_ENV === "preview";
}

export function qaSignInMode(env: Env): "preview" | "local" | null {
  if (env.HARVEST_QA_SIGN_IN === "preview" && isQaPreviewEnvironment(env) &&
    qaDatabaseAllowed(env.DATABASE_URL, "preview")) return "preview";
  if (env.HARVEST_QA_SIGN_IN === "local" && env.NODE_ENV !== "production" && env.VERCEL_ENV === undefined &&
    qaDatabaseAllowed(env.DATABASE_URL, "local")) return "local";
  return null;
}

let alarmLogged = false;

export function assertQaSignInSafe(env: Env) {
  if (env.HARVEST_QA_SIGN_IN === undefined ||
    !(env.VERCEL_ENV === "production" || (env.NODE_ENV === "production" && env.VERCEL_ENV === undefined))) return;
  if (!alarmLogged) {
    console.error("qa_sign_in_misconfigured");
    alarmLogged = true;
  }
  throw new Error("QA_SIGN_IN_MISCONFIGURED");
}

export function qaSignInSecrets(env: Env) {
  if (!qaSignInMode(env)) return null;
  const key = env.QA_SIGN_IN_SECRET;
  const helperKey = env.QA_SIGN_IN_HELPER_SECRET;
  if (!key || !helperKey || !env.BETTER_AUTH_SECRET || key === helperKey ||
    key === env.BETTER_AUTH_SECRET || helperKey === env.BETTER_AUTH_SECRET) return null;
  return { key, helperKey };
}
