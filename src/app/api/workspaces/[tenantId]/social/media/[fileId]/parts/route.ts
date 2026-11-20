import { signSocialUpload } from "@/server/files/social-upload";
import { publishResponse } from "@/server/social/publish-http";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; fileId: string }> };

export function POST(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId, fileId }, deps) =>
    signSocialUpload(db, user, tenantId, fileId, await request.json(), getStorage(), deps));
}
