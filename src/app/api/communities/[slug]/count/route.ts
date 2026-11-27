import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { countCommunityEvent } from "@/server/community-acquisition";
import { readBoundedJson } from "@/server/request-json";
import { throttlePublicRead } from "@/server/public-read-limit";
export const runtime = "nodejs";
// Anonymous beacon: a visit or a join click. No cookie, no address, no user. Hard-off (COMMUNITY_ACQUISITION_COUNTING_ENABLED is the literal false); every answer is the same 204, except the per-visitor throttle's 429, charged before the slug is looked at.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  const limited = await throttlePublicRead(request, "community-beacon");
  if (limited) return limited;
  try {
    const { slug } = await context.params;
    const body = await readBoundedJson(request, 256, () => new Error("TOO_LARGE")).catch(() => ({})) as { kind?: unknown };
    await countCommunityEvent(getDb(), slug, body?.kind, request.headers);
  } catch { /* counting is best effort and never reveals anything */ }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
