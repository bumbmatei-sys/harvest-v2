import { getDb } from "@/db/client";
import { createCommunity, listCommunities } from "@/server/communities";
import { communitiesEnabled } from "@/server/communities-mode";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
const off = () => new Response(null, { status: 404 });
export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  if (!communitiesEnabled()) return off();
  try { const user = await verifiedUser(request), { tenantId } = await context.params; return Response.json(await listCommunities(getDb(), user, tenantId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  if (!communitiesEnabled()) return off();
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createCommunity(getDb(), user, tenantId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
