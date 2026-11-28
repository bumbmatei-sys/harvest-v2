import { getDb } from "@/db/client";
import { connectCourseSetting } from "@/server/connect-beginner-course";
import { requireSyntheticIntake } from "@/server/connect-intake-context";
import { intakeBody, intakeHeaders } from "@/server/connect-intake-http";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

async function settings(request: Request, context: Context, write: boolean) {
  try {
    requireSyntheticIntake();
    if (write) verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId } = await context.params;
    const input = write ? await intakeBody(request) : undefined;
    return Response.json(await connectCourseSetting(getDb(), user, tenantId, input), { headers: intakeHeaders });
  } catch (error) {
    const response = errorResponse(error);
    for (const [key, value] of Object.entries(intakeHeaders)) response.headers.set(key, value);
    return response;
  }
}
export const GET = (request: Request, context: Context) => settings(request, context, false);
export const PUT = (request: Request, context: Context) => settings(request, context, true);
