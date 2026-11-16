import { createHmac, timingSafeEqual } from "node:crypto";

// Provider-neutral: lowercase hex HMAC-SHA256 of the raw body. Every secret is checked (no early exit) so the time taken
// does not reveal which, if any, matched.
export const signBody = (rawBody: string, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");
export function verifyBodySignature(rawBody: string, signature: string | null, secrets: readonly string[]): boolean {
  const valid = typeof signature === "string" && /^[a-f0-9]{64}$/.test(signature);
  const given = Buffer.from(valid ? signature : "0".repeat(64), "hex");
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(signBody(rawBody, secret), "hex");
    if (timingSafeEqual(given, expected)) matched = true;
  }
  return valid && matched;
}
