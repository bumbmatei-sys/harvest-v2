// HC-05 has no live activation path. Test intake requires a disposable LOCAL database and
// explicit synthetic mode, and is unconditionally disabled in a production build/runtime.
export function syntheticIntakeEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV === "production" || env.HARVEST_CONNECT_INTAKE !== "synthetic") return false;
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(url.hostname) && /^\/harvest_test(?:_|$)/.test(url.pathname)
      && /^[a-f0-9]{64}$/.test(env.HARVEST_CONNECT_TEST_KEY ?? "");
  } catch { return false; }
}
