import { readPublishingStatus } from "@/server/social/publishing-status";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
export function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  return publishResponse(request, context, false, (db, user, { tenantId }, deps) => readPublishingStatus(db, user, tenantId, Object.fromEntries(new URL(request.url).searchParams), deps));
}
