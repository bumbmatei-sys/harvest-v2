import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { enterCommunity } from "@/server/community-joining";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
const off = () => new Response(null, { status: 404 });
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) return off();
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { slug } = await context.params;
    return Response.json(await enterCommunity(getDb(), user, slug, await request.json()));
  } catch (error) { return errorResponse(error); }
}
