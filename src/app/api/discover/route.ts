import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { listDiscover } from "@/server/community-joining";
import { errorResponse } from "@/server/http";
export const runtime = "nodejs";
// Public: returns only sanitized, approved listing fields from the Discover projection.
export async function GET(request: Request) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    const params = new URL(request.url).searchParams;
    const query = { q: params.get("q") ?? undefined, open: params.get("open") === "1", after: params.get("after") ?? undefined };
    return Response.json(await listDiscover(getDb(), query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
