import { createHmac } from "node:crypto";
import { getIPFromHeader } from "@better-auth/core/utils/ip";

/**
 * Rate-limit identity for a hosted-form visitor: the client address from the same
 * configuration sign-in uses (AUTH_IP_ADDRESS_HEADERS, default x-forwarded-for;
 * AUTH_TRUSTED_PROXIES), keyed-hashed so no raw address is stored or logged.
 * Node deployments must set a trusted header, since a bare x-forwarded-for is
 * client-controlled. Workers set cf-connecting-ip, which Cloudflare overwrites;
 * hosted forms are not served from Workers yet. No usable address means no key.
 */
export function crmFormVisitorKey(request: Request, key: Buffer, env: Record<string, string | undefined> = process.env) {
  const list = (value?: string) => value?.split(",").map(item => item.trim()).filter(Boolean) ?? [];
  const headers = list(env.AUTH_IP_ADDRESS_HEADERS);
  const options = { ipAddressHeaders: headers.length ? headers : ["x-forwarded-for"], trustedProxies: list(env.AUTH_TRUSTED_PROXIES) };
  for (const header of options.ipAddressHeaders) {
    const value = request.headers.get(header);
    const address = value && getIPFromHeader(value, options);
    if (address) return createHmac("sha256", key).update(`crm-form-visitor:${address}`).digest("hex");
  }
  return null;
}
