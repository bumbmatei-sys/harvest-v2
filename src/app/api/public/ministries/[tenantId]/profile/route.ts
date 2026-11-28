import { getDb } from "@/db/client";
import { errorResponse } from "@/server/http";
import { publicMinistryProfile } from "@/server/ministry-profile";

export async function GET(_request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    return Response.json(await publicMinistryProfile(getDb(), tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
