import { getDb } from "@/db/client";
import { receiveAdsWebhook } from "@/server/ads/webhook";
export const runtime = "nodejs";
// Public by design: authenticity is the provider signature, checked before anything else. Hard-off, every refusal looks the same.
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  return receiveAdsWebhook(() => getDb(), request, provider);
}
