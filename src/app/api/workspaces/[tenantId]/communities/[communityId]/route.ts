import { getDb } from "@/db/client";
import { getCommunity, updateCommunity } from "@/server/communities";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Params = { params: Promise<{ tenantId: string; communityId: string }> };
const off = () => new Response(null, { status: 404 });
export async function GET(request: Request, context: Params) {
  if (!communitiesEnabled()) return off();
  try { const user = await verifiedUser(request), { tenantId, communityId } = await context.params; return Response.json(await getCommunity(getDb(), user, tenantId, communityId)); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Params) {
  if (!communitiesEnabled()) return off();
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, communityId } = await context.params;
    return Response.json(await updateCommunity(getDb(), user, tenantId, communityId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
