import { createHmac, hkdfSync, randomUUID } from "node:crypto";
import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import { findInvalidTrustedProxies, getIPFromHeader } from "@better-auth/core/utils/ip";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, authSchema } from "../db/schema";
import { withUser } from "./tenancy";
import { sendSignInCode } from "./email";

export const otpPolicy = { digits: 6, expiresIn: 600, attempts: 5, cooldownSeconds: 60, codesPerHour: 5, codesPerDay: 20 } as const;
export function makeAuth(db: Database, config: {
  secret: string; baseURL: string; ipAddressHeaders?: string[]; trustedProxies?: string[];
}) {
  const ipAddress = { ipAddressHeaders: config.ipAddressHeaders ?? ["x-forwarded-for"], trustedProxies: config.trustedProxies ?? [] };
  if (!ipAddress.ipAddressHeaders.length || findInvalidTrustedProxies(ipAddress.trustedProxies).length) {
    throw new Error("Invalid trusted client IP configuration");
  }
  const otpKey = hkdfSync("sha256", config.secret, "Harvest", "sign-in-email-otp:v1", 32);
  const auth = betterAuth({
    appName: "Harvest", secret: config.secret, baseURL: config.baseURL,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, transaction: true }),
    emailAndPassword: { enabled: false },
    advanced: { ipAddress },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30,
      customRules: { "/email-otp/send-verification-otp": { window: 60, max: 3 }, "/sign-in/email-otp": { window: 60, max: 10 } } },
    hooks: { before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/email-otp/send-verification-otp") return;
      // Better Auth normally logs and swallows delivery failures. This request-scoped
      // context awaits delivery so the UI can show a retryable error instead of success.
      if (ctx.body?.type !== "sign-in") throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are supported." });
      const parsed = z.email().safeParse(ctx.body?.email);
      if (!parsed.success) throw new APIError("BAD_REQUEST", { message: "Enter a valid email address." });
      const email = parsed.data.toLowerCase();
      const reservation = randomUUID();
      // The row conflict serializes cooldown and rolling issuance checks across instances.
      const result = await db.execute(sql`
        insert into otp_cooldowns (email, sent_at, issued_at, reservation_id)
        values (${email}, now(), array[now()], ${reservation})
        on conflict (email) do update set sent_at = now(), reservation_id = ${reservation},
          issued_at = array(select t from unnest(otp_cooldowns.issued_at) t
            where t > now() - interval '24 hours') || array[now()]
        where otp_cooldowns.sent_at <= now() - interval '60 seconds'
          and (select count(*) from unnest(otp_cooldowns.issued_at) t
            where t > now() - interval '1 hour') < ${otpPolicy.codesPerHour}
          and (select count(*) from unnest(otp_cooldowns.issued_at) t
            where t > now() - interval '24 hours') < ${otpPolicy.codesPerDay}
        returning email`);
      if (!result.rowCount) throw new APIError("TOO_MANY_REQUESTS", { message: "Please wait before requesting another code (60 seconds between codes, 5 per hour, 20 per day)." });
      ctx.context.runInBackgroundOrAwait = async (promise) => {
        try { await promise; }
        catch (error) {
          await db.transaction(async (tx) => {
            // A late failure must not release or delete a newer send's reservation/code.
            const released = await tx.execute(sql`
              update otp_cooldowns set issued_at = array_remove(issued_at, sent_at),
                sent_at = '-infinity', reservation_id = null
              where email = ${email} and reservation_id = ${reservation} returning email`);
            if (released.rowCount) await tx.execute(sql`
              delete from verifications where identifier = ${`sign-in-otp-${email}`}`);
          });
          throw error;
        }
      };
    }) },
    plugins: [emailOTP({
      otpLength: otpPolicy.digits, expiresIn: otpPolicy.expiresIn, allowedAttempts: otpPolicy.attempts,
      // Keyed hash also protects low-entropy codes from offline brute forcing after a DB leak.
      storeOTP: { hash: async (otp) => {
        const email = z.email().parse(getCurrentAuthEndpointContext().body?.email).toLowerCase();
        return createHmac("sha256", otpKey).update(JSON.stringify([email, otp])).digest("hex");
      } },
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are supported." });
        await sendSignInCode(email, otp);
      },
    })],
    databaseHooks: { session: { create: { after: async (session) => {
      await withUser(db, session.userId, (tx) => tx.insert(auditLogs).values({ actorId: session.userId, action: "auth.sign_in", targetId: session.id }));
    } } } },
    // Avoid logging provider responses, email addresses, codes, URLs, or database errors.
    logger: { disabled: false, log: (level) => { if (level === "error" || level === "warn") console.error(`auth_${level}`); } },
  });
  return {
    ...auth,
    handler: async (request: Request) => {
      // Check before Better Auth's limiter, including in development/test where it
      // otherwise substitutes localhost. Never create a global "no-trusted-ip" bucket.
      const clientIP = ipAddress.ipAddressHeaders.some((header) => {
        const value = request.headers.get(header);
        return value && getIPFromHeader(value, ipAddress);
      });
      if (!clientIP) return Response.json({ error: "Trusted client IP unavailable." }, { status: 503 });
      return auth.handler(request);
    },
  };
}
