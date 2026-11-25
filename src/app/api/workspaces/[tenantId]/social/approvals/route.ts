import { listApprovals, requestApproval } from "@/server/social/approvals";
import { publishInvalid } from "@/server/social/publish-access";
import { publishResponse } from "@/server/social/publish-http";
import { readBoundedJson } from "@/server/request-json";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
const approvalBody = (request: Request) => readBoundedJson(request, 16_384, () => publishInvalid("APPROVAL_REQUEST_TOO_LARGE")) as Promise<unknown>;
export function GET(request: Request, context: Context) {
  return publishResponse(request, context, false, (db, user, { tenantId }, deps) => listApprovals(db, user, tenantId, { status: new URL(request.url).searchParams.get("status") ?? undefined }, deps));
}
export function POST(request: Request, context: Context) {
  return publishResponse(request, context, true, async (db, user, { tenantId }, deps) => requestApproval(db, user, tenantId, await approvalBody(request), deps), 201);
}
