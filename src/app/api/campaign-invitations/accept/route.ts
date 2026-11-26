import { getDb } from "@/db/client";
import { acceptInvitation } from "@/server/campaign-wizard-invitations";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
// The signed-in person accepts the invitation their link was made for: { token }.
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    return Response.json(await acceptInvitation(getDb(), user, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
