import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { replayJob } from "@/server/jobs/service";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ tenantId: string; jobId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId, jobId } = await context.params;
    return Response.json(await replayJob(getDb(), user, tenantId, jobId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
