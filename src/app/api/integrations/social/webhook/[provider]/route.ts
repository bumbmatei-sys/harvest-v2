import { getDb } from "@/db/client";
import { receiveSocialWebhook } from "@/server/social/webhook";
export const runtime = "nodejs";
// Public by design: authenticity is the provider signature, checked before anything else. Every refusal looks the same.
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  return receiveSocialWebhook(() => getDb(), request, provider);
}
