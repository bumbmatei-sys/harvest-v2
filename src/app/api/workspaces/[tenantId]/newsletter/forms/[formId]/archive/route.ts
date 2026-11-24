import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { newsletterEnabled } from "@/server/newsletter";
import { archiveNewsletterSignupForm } from "@/server/newsletter-forms";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; formId: string }> };
// No request body: the form is named by the path.
export async function POST(request: Request, context: Context) {
  if (!newsletterEnabled()) return new Response(null, { status: 404 });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, formId } = await context.params;
    return Response.json(await archiveNewsletterSignupForm(getDb(), user, tenantId, formId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
