import { platformBody, platformResponse } from "@/server/platform/http";
import { staffResolveReport } from "@/server/platform/staff";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return platformResponse(request, true, async (db, user) => staffResolveReport(db, user, id, await platformBody(request)));
}
