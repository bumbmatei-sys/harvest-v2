import { getDb } from "@/db/client";
import { errorResponse, verifiedUser } from "@/server/http";
import { listJobs } from "@/server/jobs/service";
import { queueQuery } from "@/server/jobs/primitives";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const query = queueQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listJobs(getDb(), user, tenantId, query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
