import { createHash, createHmac } from "node:crypto";
import { getIPFromHeader } from "@better-auth/core/utils/ip";
import { getDb } from "../db/client";
import { handleProblem } from "../lib/link-in-bio";
import { bioMessagesKey, linkInBioEnabled } from "./link-in-bio-mode";
import { getPublicBio, issueBioProof, recordBioClick, submitBioMessage } from "./link-in-bio";
import { errorResponse, verifyOrigin } from "./http";
import { readBoundedJson } from "./request-json";
import { workerSettings } from "./worker-settings";
import { submitBioGivingReport } from "./ways-to-give";
import { waysToGiveEnabled } from "./ways-to-give-mode";
import { z } from "zod";

const bodyLimit = 8 * 1024, reportLimit = 4 * 1024;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;
const unavailable = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", ...extra } });
class BodyTooLarge extends Error {}

/**
 * Rate-limit identity of a visitor: the client address from the configuration sign-in uses (AUTH_IP_ADDRESS_HEADERS, default x-forwarded-for; AUTH_TRUSTED_PROXIES),
 * keyed-hashed so no raw address is stored or logged, and it lives in a one-minute counter only. A key derived from the server secret serves clicks, which do not need the
 * synthetic message key. No usable address means no key (and no counting).
 */
export function bioVisitorKey(request: Pick<Request, "headers">, env: Record<string, string | undefined> = process.env) {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  const key = createHash("sha256").update(`link-in-bio-visitor:${secret}`).digest();
  const list = (value?: string) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const configured = list(env.AUTH_IP_ADDRESS_HEADERS);
  const options = { ipAddressHeaders: configured.length ? configured : ["x-forwarded-for"], trustedProxies: list(env.AUTH_TRUSTED_PROXIES) };
  for (const header of options.ipAddressHeaders) {
    const value = request.headers.get(header);
    const address = value && getIPFromHeader(value, options);
    if (address) return createHmac("sha256", key).update(`bio-visitor:${address}`).digest("hex");
  }
  return null;
}

type Context = { params: Promise<{ handle: string }> };
const clickInput = z.object({ block: z.string().regex(/^[a-z0-9]{8}$/) }).strict();

/** POST /l/:handle/click. Aggregate only; always the same short answer so a beacon never blocks or reveals anything. */
export async function respondToBioClick(request: Request, context: Context) {
  try {
    if (!linkInBioEnabled() || workerSettings.getStore()) return unavailable();
    const { handle } = await context.params;
    if (handleProblem(handle)) return unavailable();
    let originError: unknown;
    try { verifyOrigin(request); } catch (error) { originError = error; }
    const visitor = bioVisitorKey(request);
    if (originError || !visitor) return unavailable();
    if (Number(request.headers.get("content-length")) > bodyLimit) return unavailable();
    const { block } = clickInput.parse(await readBoundedJson(request, bodyLimit, () => new BodyTooLarge()));
    const outcome = await recordBioClick(getDb(), handle, block, visitor);
    if (outcome === "limited") return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    return outcome === "ok" ? new Response(null, { status: 204, headers }) : unavailable();
  } catch (error) {
    if (error instanceof BodyTooLarge || error instanceof z.ZodError || error instanceof SyntaxError) return unavailable();
    return errorResponse(error);
  }
}

/** GET /l/:handle/message: a fresh ten-minute proof, only while the page is published with an enabled message block in a synthetic environment. */
export async function respondToBioProof(_request: Request, context: Context) {
  try {
    const key = bioMessagesKey();
    if (!key || workerSettings.getStore()) return unavailable();
    const { handle } = await context.params;
    if (handleProblem(handle)) return unavailable();
    const view = await getPublicBio(getDb(), handle);
    if (!view?.tabs.some((t) => t.blocks.some((block) => block.type === "message"))) return unavailable();
    return json({ proof: issueBioProof(handle, key) });
  } catch (error) { return errorResponse(error); }
}

/** POST /l/:handle/message: same origin, JSON, 8 KiB, honeypot, proof and database rate limits. The reply never says whether anything exists beyond "unavailable". */
export async function respondToBioMessage(request: Request, context: Context) {
  try {
    const key = bioMessagesKey();
    if (!key || workerSettings.getStore()) return unavailable();
    const { handle } = await context.params;
    if (handleProblem(handle)) return unavailable();
    let originError: unknown;
    try { verifyOrigin(request); } catch (error) { originError = error; }
    const visitor = bioVisitorKey(request);
    if (originError || !visitor) return unavailable();
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "json_required" }, 415);
    if (Number(request.headers.get("content-length")) > bodyLimit) throw new BodyTooLarge();
    const input = await readBoundedJson(request, bodyLimit, () => new BodyTooLarge());
    switch (await submitBioMessage(getDb(), handle, input, key, visitor)) {
      case "ok": return json({ accepted: true });
      case "not_found": return unavailable();
      case "limited": return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
      case "conflict": return json({ error: "submission_conflict" }, 409);
      default: return json({ error: "invalid_submission" }, 400);
    }
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: "body_too_large" }, 413);
    return errorResponse(error);
  }
}

/** POST /l/:handle/report: a visitor reports the page's Ways to give block. Same origin, JSON, 4 KiB, honeypot, database rate limits; no account needed. */
export async function respondToBioGivingReport(request: Request, context: Context) {
  try {
    if (!waysToGiveEnabled() || workerSettings.getStore()) return unavailable();
    const { handle } = await context.params;
    if (handleProblem(handle)) return unavailable();
    let originError: unknown;
    try { verifyOrigin(request); } catch (error) { originError = error; }
    const visitor = bioVisitorKey(request);
    if (originError || !visitor) return unavailable();
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "json_required" }, 415);
    if (Number(request.headers.get("content-length")) > reportLimit) throw new BodyTooLarge();
    const input = await readBoundedJson(request, reportLimit, () => new BodyTooLarge());
    switch (await submitBioGivingReport(getDb(), handle, input, visitor)) {
      case "ok": return json({ accepted: true });
      case "limited": return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
      case "invalid": return json({ error: "invalid_submission" }, 400);
      default: return unavailable();
    }
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: "body_too_large" }, 413);
    return errorResponse(error);
  }
}
