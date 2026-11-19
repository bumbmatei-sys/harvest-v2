import { createHmac, hkdfSync } from "node:crypto";

export const otpPolicy = { digits: 6, expiresIn: 600, attempts: 5, cooldownSeconds: 60, codesPerHour: 5, codesPerDay: 20 } as const;

export function authOtpKey(secret: string) {
  return hkdfSync("sha256", secret, "Harvest", "sign-in-email-otp:v1", 32);
}

export function authOtpHash(key: ReturnType<typeof authOtpKey>, email: string, otp: string) {
  return createHmac("sha256", key).update(JSON.stringify([email, otp])).digest("hex");
}
