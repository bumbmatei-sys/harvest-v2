import { discoverResponse } from "@/server/discover/http";
import { listMyListings } from "@/server/discover/owner";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  return discoverResponse(request, { write: false, session: true }, (db, user, deps) => listMyListings(db, user, tenantId, deps));
}
