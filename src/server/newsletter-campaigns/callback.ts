import type { Pool } from "pg";
import { createPool } from "../../db/pool";
import { requireWorkerRole, workerDatabaseUrl } from "../worker-role";
import { FakeNewsletterProvider } from "./fake-provider";
import type { NewsletterProvider } from "./port";
import { newsletterWorkerEnabled } from "./worker";

const headers = { "Cache-Control": "private, no-store" };

export async function readCallback(request: Request) {
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
  open: (url: string) => Pool = createPool, now = new Date(),
  verifier?: Pick<NewsletterProvider, "verifyCallback">) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_CALLBACK_ENABLED")) return new Response(null, { status: 404, headers });
  const neutral = () => new Response(null, { status: 202, headers });
  let event;
  try {
    const secret = env.HARVEST_NEWSLETTER_CALLBACK_KEY;
    const provider = verifier ?? (secret && /^[0-9a-f]{64}$/i.test(secret)
      ? new FakeNewsletterProvider(Buffer.from(secret, "hex")) : null);
    const body = provider && await readCallback(request);
    event = body && provider?.verifyCallback(body, request.headers, now);
  } catch { return neutral(); }
  if (!event) return neutral();

  let pool: Pool | undefined;
  try {
    pool = open(workerDatabaseUrl(env));
    await requireWorkerRole(pool);
    await pool.query("select public.newsletter_apply_callback($1,$2,$3,$4,$5,$6)",
      [event.messageId, event.signedAt, event.deliveryId, event.reference, event.type, event.at]);
    return neutral();
  } catch {
    console.error("newsletter_callback_failed");
    return new Response(null, { status: 503, headers });
  } finally {
    await pool?.end().catch(() => console.error("newsletter_callback_cleanup_failed"));
  }
}
