/**
 * Configuration for the production smoke suite. It reads only environment
 * variable names it knows, and never includes a secret value in an error.
 */
export type SmokeConfig = {
  baseURL: string; origin: string;
  sessionCookie: { name: string; value: string } | null;
  email: string | null; workspaceName: string | null;
  bypassSecret: string | null;
};
type Env = Record<string, string | undefined>;
const value = (env: Env, name: string) => env[name]?.trim() || null;

export function smokeConfig(env: Env = process.env): SmokeConfig {
  const raw = value(env, "HARVEST_SMOKE_BASE_URL");
  if (!raw) throw new Error("HARVEST_SMOKE_BASE_URL is required.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("HARVEST_SMOKE_BASE_URL must be an absolute URL."); }
  const local = env.HARVEST_SMOKE_ALLOW_HTTP === "1" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("HARVEST_SMOKE_BASE_URL must use https.");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("HARVEST_SMOKE_BASE_URL must be a bare origin, such as https://app.example.");
  }
  const token = value(env, "HARVEST_SMOKE_SESSION_TOKEN"), email = value(env, "HARVEST_SMOKE_EMAIL");
  const workspaceName = value(env, "HARVEST_SMOKE_WORKSPACE");
  const signedIn = [token, email, workspaceName];
  if (signedIn.some(Boolean) && !signedIn.every(Boolean)) {
    throw new Error("Set all of HARVEST_SMOKE_SESSION_TOKEN, HARVEST_SMOKE_EMAIL and HARVEST_SMOKE_WORKSPACE, or none of them.");
  }
  if (env.HARVEST_SMOKE_REQUIRE_SIGNED_IN === "1" && !token) {
    throw new Error("Signed-in checks are required: set HARVEST_SMOKE_SESSION_TOKEN, HARVEST_SMOKE_EMAIL and HARVEST_SMOKE_WORKSPACE.");
  }
  // Better Auth prefixes its cookie with __Secure- whenever the site is served over https.
  const cookieName = `${url.protocol === "https:" ? "__Secure-" : ""}better-auth.session_token`;
  return {
    baseURL: url.origin, origin: url.origin,
    // Accept the cookie value exactly as a browser's cookie panel shows it (URL-encoded or not).
    sessionCookie: token ? { name: cookieName, value: token.includes("%") ? token : encodeURIComponent(token) } : null,
    email: email?.toLowerCase() ?? null, workspaceName,
    bypassSecret: value(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
  };
}

/** The smoke suite only ever reads. Anything else is aborted and fails the run. */
export function isReadOnlyMethod(method: string) {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}
