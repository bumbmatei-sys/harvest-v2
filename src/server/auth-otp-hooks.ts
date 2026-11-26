import type { Database } from "../db/client";
import type { AuthOtpHooks } from "./auth-otp-hooks-contract";
import { qaShortcutAudit, qaShortcutCode, qaShortcutDeliver } from "./qa-shortcut-scope";

// Ordinary requests carry no QA shortcut scope, so these hooks generate nothing, send normally and add no audit marker.
export const authOtpHooks: (database: Database) => AuthOtpHooks = () => ({
    run: (handler) => handler(),
    reserve: () => undefined,
    prepareVerification: async () => undefined,
    storedHash: (_email, hash) => hash,
    generate: qaShortcutCode,
    deliver: qaShortcutDeliver,
    auditMetadata: qaShortcutAudit,
});

export const qaOtpResponse: (request: Request, database: () => Database) => Promise<Response> = async () => {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
};
