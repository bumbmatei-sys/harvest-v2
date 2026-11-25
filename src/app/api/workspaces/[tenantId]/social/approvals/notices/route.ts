import { listApprovalNotices } from "@/server/social/approvals";
import { publishResponse } from "@/server/social/publish-http";

export const runtime = "nodejs";
export function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  return publishResponse(request, context, false, (db, user, { tenantId }, deps) => listApprovalNotices(db, user, tenantId, deps));
}
