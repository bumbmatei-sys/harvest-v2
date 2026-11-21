export const CRM_FORMS_PRODUCTION_ENABLED = false;

export function syntheticCrmFormsKey(env: Record<string, string | undefined> = process.env) {
  if (!CRM_FORMS_PRODUCTION_ENABLED && [env.NODE_ENV, env.VERCEL_ENV, env.HARVEST_ENV].includes("production")) return null;
  if (env.HARVEST_CRM_FORMS !== "synthetic") return null;
  const key = env.HARVEST_CRM_FORMS_TEST_KEY ?? "";
  if (!/^[a-f0-9]{64}$/.test(key)) return null;
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/harvest_test(?:_|$)/.test(url.pathname)) return null;
    return Buffer.from(key, "hex");
  } catch { return null; }
}
