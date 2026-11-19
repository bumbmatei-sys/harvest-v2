import { getDb } from "../db/client";
import { newsletterEnabled } from "./newsletter";
import { confirmNewsletterSignup, newsletterSignupNotice, startNewsletterSignup, unsubscribeNewsletter } from "./newsletter-public";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const accepted = () => Response.json({ accepted: true }, { status: 202, headers });

async function bodyText(request: Request) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (!reader) return "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return "";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function newsletterPublicInfo(kind: "signup" | "unsubscribe") {
  if (!newsletterEnabled()) return new Response(null, { status: 404, headers });
  return Response.json(kind === "signup" ? { purpose: "newsletter", notice: newsletterSignupNotice, confirmationRequired: true } :
    { scopes: ["list", "all"] }, { headers });
}

export async function newsletterPublicPost(request: Request, kind: "signup" | "confirm" | "unsubscribe") {
  if (!newsletterEnabled()) return new Response(null, { status: 404, headers });
  try {
    const body = await bodyText(request);
    const fullContentType = request.headers.get("content-type") ?? "";
    const contentType = fullContentType.split(";")[0].trim().toLowerCase();
    if (kind === "unsubscribe" && body && (contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data")) {
      const values = contentType === "multipart/form-data"
        ? (await new Response(body, { headers: { "Content-Type": fullContentType } }).formData()).getAll("List-Unsubscribe")
        : new URLSearchParams(body).getAll("List-Unsubscribe");
      if (values.length === 1 && values[0] === "One-Click")
        await unsubscribeNewsletter(getDb(), "list", new URL(request.url).searchParams.get("token"));
    } else if (contentType === "application/json" && body) {
      const value: unknown = JSON.parse(body);
      if (kind === "signup") await startNewsletterSignup(getDb(), value);
      else if (kind === "confirm") await confirmNewsletterSignup(getDb(), value);
      else if (value && typeof value === "object" && "scope" in value && "token" in value &&
        (value.scope === "list" || value.scope === "all")) await unsubscribeNewsletter(getDb(), value.scope, value.token);
    }
  } catch (error) {
    // Keep even database-side failures indistinguishable to an anonymous caller.
    if (!(error instanceof SyntaxError)) console.error("newsletter_public_operation_failed");
  }
  return accepted();
}
