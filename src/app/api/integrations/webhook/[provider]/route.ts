import { getDb } from "@/db/client";
import { errorResponse } from "@/server/http";
import { receiveWebhook, WebhookRequestError } from "@/server/webhooks/receiver";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await context.params;
    return Response.json(await receiveWebhook(getDb(), request, provider), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WebhookRequestError) return Response.json({ error: error.message }, { status: error.status });
    return errorResponse(error);
  }
}
