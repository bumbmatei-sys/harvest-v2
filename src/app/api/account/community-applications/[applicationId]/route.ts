import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { updateMyApplication } from "@/server/community-joining";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
// The signed-in applicant withdraws or resubmits their own application (the definer checks ownership).
export async function PATCH(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { applicationId } = await context.params;
    return Response.json(await updateMyApplication(getDb(), user, applicationId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
