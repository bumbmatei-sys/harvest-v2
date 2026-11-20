import { createSocialUpload, getSocialUploadUsage } from "@/server/files/social-upload";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function POST(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId }, deps) =>
    createSocialUpload(db, user, tenantId, await request.json(), deps), 201);
}

export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId }) => getSocialUploadUsage(db, user, tenantId));
}
