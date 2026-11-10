import type { SmokeConfig } from "./smoke-config";

/**
 * GET requests for the smoke suite through Node's fetch, not Playwright's
 * request context: Playwright adds every request header (cookie and bypass
 * secret included) to the error it throws, and that error reaches the CI log
 * and the JUnit report. Errors here name only the method, path and status.
 */
export type SmokeResponse = { status: number; contentType: string; text: string };
export async function smokeGet(config: SmokeConfig, path: string, options: { signedIn?: boolean } = {}): Promise<SmokeResponse> {
  if (!path.startsWith("/")) throw new Error("Smoke paths must start with /.");
  const headers: Record<string, string> = {};
  if (config.bypassSecret) headers["x-vercel-protection-bypass"] = config.bypassSecret;
  if (options.signedIn) {
    if (!config.sessionCookie) throw new Error("Signed-in smoke settings are not configured.");
    headers.cookie = `${config.sessionCookie.name}=${config.sessionCookie.value}`;
  }
  let response: Response;
  try {
    response = await fetch(new URL(path, config.baseURL), { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error(`GET ${path} did not complete (network error or timeout).`);
  }
  let text: string;
  try { text = await response.text(); } catch { throw new Error(`GET ${path} returned ${response.status} but its body could not be read.`); }
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", text };
}
export function json(response: SmokeResponse, path: string): unknown {
  try { return JSON.parse(response.text); } catch { throw new Error(`GET ${path} did not return JSON (status ${response.status}).`); }
}
