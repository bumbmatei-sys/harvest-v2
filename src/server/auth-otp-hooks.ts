import type { Database } from "../db/client";
import type { AuthOtpHooks } from "./auth-otp-hooks-contract";

export function authOtpHooks(): AuthOtpHooks {
  return {
    run: (handler) => handler(),
    reserve: () => undefined,
    generate: () => undefined,
    deliver: (_input, send) => send(),
    auditMetadata: () => ({}),
  };
}

export const qaOtpResponse: (request: Request, database: () => Database) => Promise<Response> = async () => {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
};
