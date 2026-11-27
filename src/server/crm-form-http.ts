import { getDb } from "../db/client";
import { message } from "../i18n/messages";
import { syntheticCrmFormsKey } from "./crm-form-mode";
import { crmFormManifest, resolveCrmForm, submitCrmForm, type CrmFormCharge } from "./crm-form-submission";
import { crmFormVisitorKey } from "./crm-form-visitor";
import { errorResponse, verifyOrigin } from "./http";
import { readBoundedJson } from "./request-json";
import { newsletterFormCountsClicks } from "./newsletter-clicks";
import { signupTexts } from "../lib/newsletter-signup";
import { workerSettings } from "./worker-settings";

export type CrmFormContext = { params: Promise<{ slug: string }> };
const bodyLimit = 32 * 1024;
const unavailable = () => Response.json({ error: message("CrmForms.errors.notFound") }, { status: 404 });

class BodyTooLarge extends Error {}

export async function respondToCrmForm(request: Request, context: CrmFormContext, submit: boolean) {
  const result = await handleCrmForm(request, context, submit);
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

async function handleCrmForm(request: Request, context: CrmFormContext, submit: boolean) {
  if (workerSettings.getStore()) return unavailable();
  const key = syntheticCrmFormsKey();
  if (!key) return unavailable();
  try {
    const { slug } = await context.params;
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) return unavailable();
    let originError: unknown;
    if (submit) {
      try { verifyOrigin(request); } catch (error) { originError = error; }
    }
    const db = getDb();
    // Every missing, retired or disabled form returns exactly the same response,
    // including POSTs that arrive with invalid origins or bodies.
    const visitor = crmFormVisitorKey(request, key);
    if (!visitor) return Response.json({ error: "unavailable" }, { status: 503 });
    const charge: CrmFormCharge = originError ? { mode: "peek" } : { mode: submit ? "submit" : "proof", visitor };
    const form = await resolveCrmForm(db, slug, charge);
    if (!form) return unavailable();
    if (originError) throw originError;
    if ("limited" in form) {
      return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
    }
    if (!submit) {
      const manifest = crmFormManifest(form, slug, key);
      if (!manifest.newsletter) return Response.json(manifest);
      // A newsletter sign-up page shows the wording that applies now: newsletter-consent-v2, which adds the clicks line to the consent statement,
      // while the ministry counts link clicks, and the form's frozen wording otherwise. The submission must name the wording it showed.
      const clicksCounted = await newsletterFormCountsClicks(db, slug);
      const newsletter = signupTexts(manifest.newsletter, clicksCounted);
      const blocks = manifest.blocks.map((block) => block.type === "consent" ? { ...block, label: newsletter.consentText, text: `${newsletter.consentText} ${newsletter.fixedNotice}` } : block);
      return Response.json({ ...manifest, blocks, newsletter, clicksCounted });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: "json_required" }, { status: 415 });
    }
    if (Number(request.headers.get("content-length")) > bodyLimit) throw new BodyTooLarge();
    const input = await readBoundedJson(request, bodyLimit, () => new BodyTooLarge());
    const outcome = await submitCrmForm(db, form, slug, input, key);
    switch (outcome) {
      case "ok": return Response.json({ accepted: true });
      case "not_found": return unavailable();
      case "conflict": return Response.json({ error: "submission_conflict" }, { status: 409 });
      case "invalid": case "spam": return Response.json({ error: "invalid_submission" }, { status: 400 });
      default: throw new Error("UNKNOWN_FORM_SUBMISSION_OUTCOME");
    }
  } catch (error) {
    if (error instanceof BodyTooLarge) return Response.json({ error: "body_too_large" }, { status: 413 });
    return errorResponse(error);
  }
}
