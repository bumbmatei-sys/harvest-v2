import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import { APIError } from "better-auth/api";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { otpCooldowns, verifications } from "../db/schema";
import { message } from "../i18n/messages";
import type { AuthOtpHooks, AuthOtpInput } from "./auth-otp-hooks-contract";
import { qaSignInMode, qaSignInSecrets } from "./qa-sign-in-gate";

const synthetic = (email: string) => email.toLowerCase().endsWith("@qa.harvest.invalid");
const requestOtp = new AsyncLocalStorage<{ email?: string; sentAt?: Date; derived?: boolean }>();
const digest = (value: string) => createHash("sha256").update(value).digest();
const bucketMs = 600_000;

function qaCode(key: string, email: string, sentAt: Date) {
  return (createHmac("sha256", key).update(JSON.stringify([email, Math.floor(sentAt.getTime() / bucketMs)]))
    .digest().readUInt32BE() % 1_000_000).toString().padStart(6, "0");
}

function usesQaPath(input: AuthOtpInput) {
  return input.type === "sign-in" && synthetic(input.email) && qaSignInMode(process.env);
}

export function authOtpHooks(): AuthOtpHooks {
  return {
    run: (handler) => requestOtp.run({}, handler),
    reserve(email, sentAt) {
      const state = requestOtp.getStore();
      if (state) Object.assign(state, { email, sentAt });
    },
    generate(input) {
      if (!usesQaPath(input)) return undefined;
      const state = requestOtp.getStore();
      const secrets = qaSignInSecrets(process.env);
      if (!secrets || !state?.sentAt || state.email !== input.email) {
        // Never send a synthetic code through the mail provider in QA mode.
        return undefined;
      }
      state.derived = true;
      return qaCode(secrets.key, input.email, state.sentAt);
    },
    async deliver(input, send) {
      if (!usesQaPath(input)) return send();
      if (!requestOtp.getStore()?.derived) {
        throw new APIError("SERVICE_UNAVAILABLE", { message: message("Errors.somethingWentWrongPleaseTryAgain") });
      }
    },
    auditMetadata(): Record<string, string> {
      if (!qaSignInMode(process.env) || !requestOtp.getStore()) return {};
      const ctx = getCurrentAuthEndpointContext();
      const parsed = z.email().safeParse(ctx.body?.email);
      if (ctx.path !== "/sign-in/email-otp" || !parsed.success ||
        !usesQaPath({ email: parsed.data, type: "sign-in" })) return {};
      console.info("qa_sign_in");
      return { qa_test_sign_in: "true" };
    },
  };
}

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };

export async function qaOtpResponse(request: Request, database: () => Database) {
  const hidden = () => new Response(null, { status: 404, headers });
  const secrets = qaSignInSecrets(process.env);
  if (!secrets || !timingSafeEqual(digest(request.headers.get("x-qa-secret") ?? ""), digest(secrets.helperKey))) return hidden();
  const email = z.email().safeParse(new URL(request.url).searchParams.get("email")?.toLowerCase());
  if (!email.success || !synthetic(email.data)) return hidden();
  const [issued] = await database().select({ sentAt: otpCooldowns.sentAt }).from(otpCooldowns)
    .innerJoin(verifications, eq(verifications.identifier, `sign-in-otp-${email.data}`))
    .where(and(eq(otpCooldowns.email, email.data), isNotNull(otpCooldowns.reservationId),
      sql`${otpCooldowns.sentAt} > now() - interval '600 seconds'`,
      sql`${otpCooldowns.sentAt} <= now() and ${verifications.expiresAt} > now()`));
  if (!issued) return hidden();
  return Response.json({ code: qaCode(secrets.key, email.data, issued.sentAt) }, { headers });
}
