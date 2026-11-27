import { getDb } from "../db/client";
import { giveSlugPattern } from "../lib/give-page";
import { givePageEnabled } from "./give-page-mode";
import { submitGiveReport } from "./give-page";
import { errorResponse, verifyOrigin } from "./http";
import { bioVisitorKey } from "./link-in-bio-public";
import { readBoundedJson } from "./request-json";
import { workerSettings } from "./worker-settings";

const reportLimit = 4 * 1024;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", ...extra } });
const unavailable = () => json({ error: "not_found" }, 404);
class BodyTooLarge extends Error {}

/**
 * POST /give/:slug/report: a visitor reports a public fundraising page (its Ways to give block). Same origin, JSON, 4 KiB, honeypot, the shared giving report
 * minute limits (per hashed visitor and ministry, per ministry); no account, nothing sent to anyone. Unknown and non-public pages answer the same 404.
 */
export async function respondToGiveReport(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    if (!givePageEnabled() || workerSettings.getStore()) return unavailable();
    const { slug } = await context.params;
    if (!giveSlugPattern.test(slug)) return unavailable();
    let originError: unknown;
    try { verifyOrigin(request); } catch (error) { originError = error; }
    const visitor = bioVisitorKey(request);
    if (originError || !visitor) return unavailable();
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "json_required" }, 415);
    if (Number(request.headers.get("content-length")) > reportLimit) throw new BodyTooLarge();
    const input = await readBoundedJson(request, reportLimit, () => new BodyTooLarge());
    switch (await submitGiveReport(getDb(), slug, input, visitor)) {
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
