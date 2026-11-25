import { decideApproval } from "@/server/social/approvals";
import { publishInvalid } from "@/server/social/publish-access";
import { publishResponse } from "@/server/social/publish-http";
import { readBoundedJson } from "@/server/request-json";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; approvalId: string }> };
export function PATCH(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId, approvalId }, deps) =>
    decideApproval(db, user, tenantId, approvalId, await readBoundedJson(request, 16_384, () => publishInvalid("APPROVAL_REQUEST_TOO_LARGE")), deps));
}
