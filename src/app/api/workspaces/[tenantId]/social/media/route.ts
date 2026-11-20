import { createSocialUpload } from "@/server/files/social-upload";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function POST(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId }) =>
    createSocialUpload(db, user, tenantId, await request.json()), 201);
}
