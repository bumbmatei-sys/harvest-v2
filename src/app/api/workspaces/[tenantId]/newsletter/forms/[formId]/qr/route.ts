import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { newsletterEnabled } from "@/server/newsletter";
import { signupFormQr } from "@/server/newsletter-forms-qr";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; formId: string }> };
// The QR code for a published sign-up form's public address, drawn by the same renderer as the Connect QR codes. Owners and admins only.
export async function GET(request: Request, context: Context) {
  if (!newsletterEnabled()) return new Response(null, { status: 404 });
  try {
    const user = await verifiedUser(request), { tenantId, formId } = await context.params;
    const format = new URL(request.url).searchParams.get("format") === "png" ? "png" : "svg";
    const result = await signupFormQr(getDb(), user, tenantId, formId, format);
    if (!result) return new Response(null, { status: 404 });
    return new Response(result.body, { headers: { "Content-Type": result.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      ...(new URL(request.url).searchParams.get("download") === "1" ? { "Content-Disposition": `attachment; filename="signup-${result.slug}.${format}"` } : {}) } });
  } catch (error) { return errorResponse(error); }
}
