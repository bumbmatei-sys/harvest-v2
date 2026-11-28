import { getDb } from "@/db/client";
import { message } from "@/i18n/messages";
import { submitAssistedIntake } from "@/server/connect-intake";
import { requireSyntheticIntake } from "@/server/connect-intake-context";
import { intakeBody, intakeHeaders } from "@/server/connect-intake-http";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; campaignId: string; kind: string; code: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireSyntheticIntake();
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId, campaignId, kind, code } = await context.params;
    const result = await submitAssistedIntake(getDb(), user, tenantId, campaignId, kind, code, await intakeBody(request));
    if (result.limited) return Response.json({ error: message("Intake.limited") }, { status: 429, headers: { ...intakeHeaders, "Retry-After": "60" } });
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: intakeHeaders });
  } catch (error) {
    const response = errorResponse(error);
    for (const [name, value] of Object.entries(intakeHeaders)) response.headers.set(name, value);
    return response;
  }
}
