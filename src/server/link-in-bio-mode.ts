/** The editor, the owner API and the public page are development-only until activated: never in production (same gate as Docs and the newsletter). */
export function linkInBioEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && env.HARVEST_ENV !== "production"; }

/** Hard-off in code: "Message me" collects nothing from real people until the privacy and security decisions are approved (docs/decisions/hc-02-activation-gates.md). */
export const BIO_MESSAGES_PRODUCTION_ENABLED = false;

/**
 * "Message me" runs in synthetic mode only, exactly like the hosted forms: a disposable local `harvest_test` database, a 64-hex test key and
 * `HARVEST_LINK_IN_BIO_MESSAGES=synthetic`. Without all three the block is not offered on the public page and the owner is told why. The database functions
 * repeat the database-name check, so a misconfigured server still cannot store a message.
 */
export function bioMessagesKey(env: Record<string, string | undefined> = process.env) {
  if (!BIO_MESSAGES_PRODUCTION_ENABLED && [env.NODE_ENV, env.VERCEL_ENV, env.HARVEST_ENV].includes("production")) return null;
  if (env.HARVEST_LINK_IN_BIO_MESSAGES !== "synthetic") return null;
  const key = env.HARVEST_LINK_IN_BIO_MESSAGES_TEST_KEY ?? "";
  if (!/^[a-f0-9]{64}$/.test(key)) return null;
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/harvest_test(?:_|$)/.test(url.pathname)) return null;
    return Buffer.from(key, "hex");
  } catch { return null; }
}
