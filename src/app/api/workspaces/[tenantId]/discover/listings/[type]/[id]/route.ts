import { discoverBody, discoverResponse } from "@/server/discover/http";
import { changeListing } from "@/server/discover/owner";

export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string; type: string; id: string }> }) {
  const { tenantId, type, id } = await context.params;
  return discoverResponse(request, { write: true, session: true }, async (db, user, deps) => changeListing(db, user, tenantId, type, id, await discoverBody(request), deps));
}
