import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// C15b: signed one-click unsubscribe tokens. The token names one person's membership in one community and can only
// switch that membership's email off. The key is derived from the server secret for this purpose only.
export const UNSUBSCRIBE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export type UnsubscribeTarget = { tenantId: string; communityId: string; userId: string };

const key = (secret: string) => Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), "Harvest community email", "unsubscribe:v1", 32));
const mac = (secret: string, payload: string) => createHmac("sha256", key(secret)).update(payload).digest();

export function signUnsubscribe(secret: string, target: UnsubscribeTarget, now = Date.now()): string {
  if (secret.length < 16) throw new Error("EMAIL_TOKEN_SECRET_INVALID");
  const payload = Buffer.from(JSON.stringify([1, target.tenantId, target.communityId, target.userId, now + UNSUBSCRIBE_TTL_MS])).toString("base64url");
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
}

/** The target if the token is genuine and unexpired, otherwise null. Never says why. */
export function verifyUnsubscribe(secret: string, token: string, now = Date.now()): UnsubscribeTarget | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const given = Buffer.from(parts[1], "base64url"), expected = mac(secret, parts[0]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const [version, tenantId, communityId, userId, expires] = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown[];
    if (version !== 1 || typeof tenantId !== "string" || typeof communityId !== "string" || typeof userId !== "string" || typeof expires !== "number") return null;
    if (expires <= now) return null;
    return { tenantId, communityId, userId };
  } catch { return null; }
}
