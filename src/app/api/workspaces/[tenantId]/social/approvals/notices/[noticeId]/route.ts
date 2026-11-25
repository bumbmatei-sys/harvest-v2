import { markApprovalNoticeRead } from "@/server/social/approvals";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
export function PATCH(request: Request, context: { params: Promise<{ tenantId: string; noticeId: string }> }) {
  return publishResponse(request, context, true, (db, user, { tenantId, noticeId }, deps) => markApprovalNoticeRead(db, user, tenantId, noticeId, deps));
}
