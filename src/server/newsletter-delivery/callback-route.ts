import type { Pool } from "pg";
import { isFakeNewsletter, NEWSLETTER_INTEGRATION_ENABLED, type FakeNewsletterRuntime } from "./registry";
import { applyNewsletterCallback } from "./worker";

export function newsletterCallbackRoute(injected?: { worker: Pick<Pool, "query">; runtime: FakeNewsletterRuntime }) {
  return async (request: Request) => {
    const headers = { "Cache-Control": "no-store" };
    if (!injected || (!NEWSLETTER_INTEGRATION_ENABLED && !isFakeNewsletter(injected.runtime))) {
      return new Response(null, { status: 404, headers });
    }
    const applied = await readNewsletterCallback(request, injected);
    return new Response(null, { status: applied === null ? 400 : 202, headers });
  };
}

export async function readNewsletterCallback(request: Request, injected: { worker: Pick<Pool, "query">; runtime: FakeNewsletterRuntime }) {
  const signature = request.headers.get("x-newsletter-signature");
  const reader = request.body?.getReader();
  if (!reader || !signature) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return applyNewsletterCallback(injected.worker, injected.runtime, Buffer.concat(chunks, length), signature);
}
