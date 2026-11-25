import { platformBody, platformResponse } from "@/server/platform/http";
import { staffDecide } from "@/server/platform/staff";
export const runtime = "nodejs";
// POST /api/platform/discover/reviews/:id/decision with { type, version, decision, reason? }. :id is the listing's resource id.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return platformResponse(request, true, async (db, user) => staffDecide(db, user, id, await platformBody(request)));
}
