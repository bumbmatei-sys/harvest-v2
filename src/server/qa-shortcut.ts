import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { getAuth } from "./auth-instance";
import { qaSyntheticEmail } from "./qa-preview-gate";
import { qaShortcutAccess, qaShortcutScope } from "./qa-shortcut-scope";

// QA-2: signs a seeded synthetic account in without email, through the normal OTP endpoints (IP limits, address
// cooldown, hourly and daily caps, hashed single-use code, session and `auth.sign_in` audit). Hidden (404) unless the
// gate is open and the caller presents the preview token. Refuses accounts outside @example.invalid and unknown accounts.
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const digest = (value: string) => createHash("sha256").update(value).digest();
const input = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) }).strict();
const forwarded = ["cf-connecting-ip", "x-forwarded-for"];

const loopback = ["localhost", "127.0.0.1", "[::1]"];
/** The app's own origin. The local dev server reports loopback requests as localhost, so loopback names are equal there. */
function sameOrigin(request: URL, own: URL) {
  if (request.origin === own.origin) return true;
  return loopback.includes(own.hostname) && loopback.includes(request.hostname) && request.protocol === own.protocol && request.port === own.port;
}

export async function qaShortcutSignIn(request: Request, database = getDb): Promise<Response> {
  const hidden = () => new Response(null, { status: 404, headers });
  const access = qaShortcutAccess();
  if (!access || request.method !== "POST") return hidden();
  if (!timingSafeEqual(digest(request.headers.get("x-qa-preview-token") ?? ""), digest(access.token))) return hidden();
  if (!sameOrigin(new URL(request.url), new URL(access.origin))) return hidden();
  const refused = () => {
    console.info("qa_shortcut_refused");
    return Response.json({ error: "QA_ACCOUNT_REFUSED" }, { status: 422, headers });
  };
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !qaSyntheticEmail(parsed.data.email)) return refused();
  const email = parsed.data.email;
  // Never create an account here: only accounts that already exist (the seed's) can be signed in to.
  const [user] = await database().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return refused();

  const forward = new Headers({ "content-type": "application/json", origin: access.origin });
  for (const name of forwarded) { const value = request.headers.get(name); if (value) forward.set(name, value); }
  const call = (path: string, body: unknown) => getAuth().handler(new Request(`${access.origin}/api/auth${path}`, {
    method: "POST", headers: forward, body: JSON.stringify(body) }));
  return qaShortcutScope.run({ email }, async () => {
    const sent = await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const code = qaShortcutScope.getStore()?.code;
    if (!sent.ok || !code) return new Response(null, { status: sent.status === 429 ? 429 : 503, headers });
    const signed = await call("/sign-in/email-otp", { email, otp: code });
    if (!signed.ok) return new Response(null, { status: signed.status === 429 ? 429 : 503, headers });
    console.info("qa_shortcut_sign_in");
    const response = new Response(null, { status: 204, headers });
    for (const cookie of signed.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  });
}
