import { changeApprovalSettings, readApprovalSettings } from "@/server/social/approvals";
import { publishInvalid } from "@/server/social/publish-access";
import { publishResponse } from "@/server/social/publish-http";
import { readBoundedJson } from "@/server/request-json";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId }, deps) => readApprovalSettings(db, user, tenantId, deps));
}
export function PUT(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId }, deps) =>
    changeApprovalSettings(db, user, tenantId, await readBoundedJson(request, 4_096, () => publishInvalid("APPROVAL_REQUEST_TOO_LARGE")), deps));
}
