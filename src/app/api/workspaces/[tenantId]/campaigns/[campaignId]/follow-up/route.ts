import { getDb } from "@/db/client";
import { campaignFollowUpCounts, campaignFollowUpTeam, setCampaignFollowUpTeamMember } from "@/server/follow-up-cases";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// CW-11, owner/admin only: a campaign's follow-up counts (no names) and its follow-up team (user ids). Every denial is the same 403.
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params, db = getDb();
    const [counts, team] = await Promise.all([campaignFollowUpCounts(db, user, tenantId, campaignId), campaignFollowUpTeam(db, user, tenantId, campaignId)]);
    return Response.json({ counts, team }, { headers });
  } catch (error) { return errorResponse(error); }
}

/** Body: { userId, member: true | false } adds or removes one active owner, admin or member. Idempotent. */
export async function PATCH(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, campaignId } = await context.params;
    return Response.json(await setCampaignFollowUpTeamMember(getDb(), user, tenantId, campaignId, await request.json()), { headers });
  } catch (error) { return errorResponse(error); }
}
