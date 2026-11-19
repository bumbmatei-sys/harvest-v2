import type { Database } from "../db/client";
import type { AuthOtpHooks } from "./auth-otp-hooks-contract";

export const authOtpHooks: (database: Database) => AuthOtpHooks = () => ({
    run: (handler) => handler(),
    reserve: () => undefined,
    prepareVerification: async () => undefined,
    storedHash: (_email, hash) => hash,
    generate: () => undefined,
    deliver: (_input, send) => send(),
    auditMetadata: () => ({}),
});

export const qaOtpResponse: (request: Request, database: () => Database) => Promise<Response> = async () => {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
};
