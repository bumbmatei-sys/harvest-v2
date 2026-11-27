import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { requestHarvestReview } from "@/server/community-takedown";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { readBoundedJson } from "@/server/request-json";
import { AccessError } from "@/server/permissions";
import { message } from "@/i18n/messages";
export const runtime = "nodejs";
// Owners and admins ask Harvest to review a community Harvest paused (0137). The database checks the role, the pause, one open request and the daily limit.
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; communityId: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, communityId } = await context.params;
    const body = await readBoundedJson(request, 8_192, () => new AccessError(400, message("Errors.checkTheSuppliedDetails")));
    return Response.json(await requestHarvestReview(getDb(), user, tenantId, communityId, body), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
