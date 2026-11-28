import { createPool } from "@/db/pool";
import { CONNECT_LIVE_ENABLED, CONNECT_WEBHOOK_SECRET } from "@/server/ministry-payments/provider";
import { handleMinistryPaymentWebhook } from "@/server/ministry-payments/webhook";
import { requireWorkerRole, workerDatabaseUrl } from "@/server/worker-role";

export async function POST(request: Request) {
  if (!CONNECT_LIVE_ENABLED) return new Response(null, { status: 404 });
  const secret = process.env[CONNECT_WEBHOOK_SECRET];
  if (!secret) return new Response(null, { status: 503 });
  const worker = createPool(workerDatabaseUrl(), 1);
  try {
    await requireWorkerRole(worker);
    return await handleMinistryPaymentWebhook(request, worker, secret, "stripe_connect");
  } finally {
    await worker.end();
  }
}
