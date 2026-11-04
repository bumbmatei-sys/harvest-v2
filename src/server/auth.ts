import { createHmac } from "node:crypto";
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

export const otpPolicy = { digits: 6, expiresIn: 600, attempts: 5, cooldownSeconds: 60 } as const;
export function makeAuth(db: Database, config: { secret: string; baseURL: string }) {
  return betterAuth({
    appName: "Harvest", secret: config.secret, baseURL: config.baseURL,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, transaction: true }),
    emailAndPassword: { enabled: false },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30,
      customRules: { "/email-otp/send-verification-otp": { window: 60, max: 3 }, "/sign-in/email-otp": { window: 60, max: 10 } } },
    hooks: { before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/email-otp/send-verification-otp") return;
      // Better Auth normally logs and swallows delivery failures. This request-scoped
      // context awaits delivery so the UI can show a retryable error instead of success.
      ctx.context.runInBackgroundOrAwait = async (promise) => { await promise; };
      if (ctx.body?.type !== "sign-in") throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are supported." });
      const parsed = z.email().safeParse(ctx.body?.email);
      if (!parsed.success) throw new APIError("BAD_REQUEST", { message: "Enter a valid email address." });
      const email = parsed.data.toLowerCase();
      const result = await db.execute(sql`
        insert into otp_cooldowns (email, sent_at) values (${email}, now())
        on conflict (email) do update set sent_at = now()
        where otp_cooldowns.sent_at <= now() - interval '60 seconds'
        returning email`);
      if (!result.rowCount) throw new APIError("TOO_MANY_REQUESTS", { message: "Please wait 60 seconds before requesting another code." });
    }) },
    plugins: [emailOTP({
      otpLength: otpPolicy.digits, expiresIn: otpPolicy.expiresIn, allowedAttempts: otpPolicy.attempts,
      // Keyed hash also protects low-entropy codes from offline brute forcing after a DB leak.
      storeOTP: { hash: async (otp) => createHmac("sha256", config.secret).update(otp).digest("hex") },
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
}
