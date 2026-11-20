import type { Pool } from "pg";
import { createPool } from "../../db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "../worker-role";
import { FakeNewsletterProvider } from "./fake-provider";
import { newsletterWorkerEnabled } from "./worker";

const headers = { "Cache-Control": "private, no-store" };

async function readCallback(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

export async function newsletterCallback(request: Request, env = process.env,
  open: (url: string) => Pool = createPool, now = new Date()) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_CALLBACK_ENABLED")) return new Response(null, { status: 404, headers });
  let pool: Pool | undefined;
  try {
    const secret = env.HARVEST_NEWSLETTER_CALLBACK_KEY;
    if (secret && /^[0-9a-f]{64}$/i.test(secret)) {
      const body = await readCallback(request);
      const event = body && new FakeNewsletterProvider(Buffer.from(secret, "hex")).verifyCallback(body, request.headers, now);
      if (event) {
        pool = open(workerDatabaseUrl(env));
        await requireWorkerRole(pool);
        const apply = () => pool!.query("select public.newsletter_delivery_event($1,$2,$3,$4)", [event.deliveryId, event.reference, event.type, event.at]);
        try { await apply(); }
        catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "40001") throw error;
          await apply();
        }
      }
    }
  } catch { console.error("newsletter_callback_failed"); }
  finally { await pool?.end().catch(() => console.error("newsletter_callback_cleanup_failed")); }
  return new Response(null, { status: 202, headers });
}
