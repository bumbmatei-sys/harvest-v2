import { getDb } from "@/db/client";
import { beginnerCourseInput, connectBeginnerCourse } from "@/server/connect-beginner-course";
import { requireSyntheticIntake } from "@/server/connect-intake-context";
import { intakeBody, intakeHeaders } from "@/server/connect-intake-http";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ kind: string; code: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireSyntheticIntake();
    verifyOrigin(request);
    const { kind, code } = await context.params;
    const input = beginnerCourseInput.parse(await intakeBody(request));
    const actor = input.action === "enrol" ? await verifiedUser(request) : undefined;
    return Response.json(await connectBeginnerCourse(getDb(), kind, code, input, actor), { headers: intakeHeaders });
  } catch (error) {
    const response = errorResponse(error);
    for (const [key, value] of Object.entries(intakeHeaders)) response.headers.set(key, value);
    return response;
  }
}
