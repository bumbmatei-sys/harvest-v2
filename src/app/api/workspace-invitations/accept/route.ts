import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { acceptInvitation } from "@/server/access";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const body = (await request.json()) as { token?: unknown };
    return Response.json(await acceptInvitation(getDb(), userId, body.token));
  } catch (error) { return errorResponse(error); }
}
