import { communitiesEnabled } from "@/server/communities-mode";
import { respondToCommunityHarvestReport } from "@/server/community-takedown";

export const runtime = "nodejs";
// Any visitor reports a public community page to Harvest (no account). Origin, JSON, size, honeypot and the minute limits are checked in the handler.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  return respondToCommunityHarvestReport(request, context);
}
