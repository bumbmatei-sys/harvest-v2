import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { otpCooldowns, verifications } from "../db/schema";
import { message } from "../i18n/messages";
import type { AuthOtpHooks, AuthOtpInput } from "./auth-otp-hooks-contract";
import { authOtpHash, authOtpKey, otpPolicy } from "./auth-otp-hash";
import { qaSignInMode, qaSignInSecrets } from "./qa-sign-in-gate";

const synthetic = (email: string) => email.toLowerCase().endsWith("@qa.harvest.invalid");
type Issuance = { email: string; sentAt: Date; reservationId: string };
const requestOtp = new AsyncLocalStorage<{ issued?: Issuance; derived?: boolean; verification?: { email: string; reservationId: string } }>();
const marker = /^qa1\.([a-f0-9-]{36})\.[a-f0-9]{64}:(\d+)$/;
const tag = (reservationId: string, hash: string) => `qa1.${reservationId}.${hash}`;
const verificationId = (email: string) => `sign-in-otp-${email}`;
const digest = (value: string) => createHash("sha256").update(value).digest();
const bucketMs = 600_000;

function qaCode(key: string, email: string, sentAt: Date) {
  return (createHmac("sha256", key).update(JSON.stringify([email, Math.floor(sentAt.getTime() / bucketMs)]))
    .digest().readUInt32BE() % 1_000_000).toString().padStart(6, "0");
}

function usesQaPath(input: AuthOtpInput) {
  return input.type === "sign-in" && synthetic(input.email) && qaSignInMode(process.env);
}

export function authOtpHooks(db: Database): AuthOtpHooks {
  return {
    run: (handler) => requestOtp.run({}, handler),
    reserve(email, sentAt, reservationId) {
      const state = requestOtp.getStore();
      if (state) state.issued = { email, sentAt, reservationId };
    },
    async prepareVerification(email) {
      const state = requestOtp.getStore();
      if (!state || !synthetic(email) || !qaSignInSecrets(process.env)) return;
      const [verification] = await db.select({ value: verifications.value }).from(verifications)
        .where(eq(verifications.identifier, verificationId(email)));
      const reservationId = marker.exec(verification?.value ?? "")?.[1];
      if (reservationId) state.verification = { email, reservationId };
    },
    storedHash(email, hash) {
      const state = requestOtp.getStore();
      const tagged = state?.verification ?? (state?.derived ? state.issued : undefined);
      return tagged?.email === email ? tag(tagged.reservationId, hash) : hash;
    },
    generate(input) {
      if (!usesQaPath(input)) return undefined;
      const state = requestOtp.getStore();
      const secrets = qaSignInSecrets(process.env);
      if (!secrets || state?.issued?.email !== input.email) {
        // Never send a synthetic code through the mail provider in QA mode.
        return undefined;
      }
      state.derived = true;
      return qaCode(secrets.key, input.email, state.issued.sentAt);
    },
    async deliver(input, send) {
      if (!usesQaPath(input)) return send();
      if (!requestOtp.getStore()?.derived) {
        throw new APIError("SERVICE_UNAVAILABLE", { message: message("Errors.somethingWentWrongPleaseTryAgain") });
      }
    },
    auditMetadata(): Record<string, string> {
      if (!requestOtp.getStore()?.verification) return {};
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
  const [issued] = await database().select({ sentAt: otpCooldowns.sentAt, reservationId: otpCooldowns.reservationId, stored: verifications.value }).from(otpCooldowns)
    .innerJoin(verifications, eq(verifications.identifier, verificationId(email.data)))
    .where(and(eq(otpCooldowns.email, email.data), isNotNull(otpCooldowns.reservationId),
      sql`${otpCooldowns.sentAt} > now() - interval '600 seconds'`,
      sql`${otpCooldowns.sentAt} <= now() and ${verifications.expiresAt} > now()`));
  if (!issued?.reservationId) return hidden();
  const match = marker.exec(issued.stored);
  if (!match || Number(match[2]) >= otpPolicy.attempts) return hidden();
  const code = qaCode(secrets.key, email.data, issued.sentAt);
  const expected = tag(issued.reservationId, authOtpHash(authOtpKey(secrets.authSecret), email.data, code)) + ":" + match[2];
  if (!timingSafeEqual(digest(expected), digest(issued.stored))) return hidden();
  return Response.json({ code }, { headers });
}
