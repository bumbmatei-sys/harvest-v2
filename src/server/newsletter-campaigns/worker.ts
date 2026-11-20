import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { publicFilePath } from "../../lib/files";
import { renderNewsletter } from "../../lib/newsletter-content";
import { newsletterKey, signNewsletterPreference } from "../newsletter-public";
import { requireWorkerRole } from "../worker-role";
import { newsletterOrigin } from "./access";
import { FakeNewsletterProvider } from "./fake-provider";
import { LIVE_NEWSLETTER_ENABLED } from "./ses-adapter";

type Claimed = { tenant: string; key: string; lease: string };
type Authorized = { email: string; firstName: string; ministryName: string; from: string; replyTo: string;
  subject: string; preheader: string | null; content: unknown; images: string[] };

export function newsletterWorkerEnabled(env: Record<string, string | undefined>, flag: string) {
  return !LIVE_NEWSLETTER_ENABLED && env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" &&
    (env.NODE_ENV === "test" || env.NODE_ENV === "development") && env[flag] === "1";
}

export async function runNewsletterWorker(pool: Pool, env: NodeJS.ProcessEnv, provider: FakeNewsletterProvider,
  options: { limit?: number; leaseSeconds?: number; beforeAuthorize?: () => Promise<void>;
    log?: (metadata: string) => void } = {}) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_WORKER_ENABLED")) return null;
  await requireWorkerRole(pool);
  const key = newsletterKey(env);
  if (!key) throw new Error("NEWSLETTER_CREDENTIAL_UNAVAILABLE");
  const origin = newsletterOrigin();
  const { rows: [{ claimed }] } = await pool.query<{ claimed: Claimed[] }>(
    "select public.newsletter_delivery_claim($1,$2) as claimed", [options.limit ?? 20, options.leaseSeconds ?? 120]);
  let errors = 0;
  for (const job of claimed) {
    try {
      const ids = [job.tenant, job.key, job.lease];
      const nonce = randomBytes(32).toString("base64url");
      const unsubscribe = new URL("/api/newsletter/unsubscribe", origin);
      unsubscribe.searchParams.set("token", signNewsletterPreference(key, "list", nonce));
      await options.beforeAuthorize?.();
      const { rows: [{ payload }] } = await pool.query<{ payload: Authorized | null }>(
        "select public.newsletter_delivery_authorize($1,$2,$3,$4) as payload", [...ids, nonce]);
      if (!payload) continue;
      const images = new Map(payload.images.map(fileId => [fileId, new URL(publicFilePath(job.tenant, fileId), origin).href]));
      let message;
      try {
        message = renderNewsletter(payload.content, { preheader: payload.preheader, firstName: payload.firstName, ministryName: payload.ministryName,
          unsubscribe: unsubscribe.href, images });
      } catch {
        await pool.query("select public.newsletter_delivery_fail($1,$2,$3,false)", ids);
        continue;
      }
      // No DB transaction spans the submission. Once authorized, loss of the receipt is ambiguous.
      try {
        const status = await provider.submit({ ...message, deliveryId: job.key, to: payload.email, from: payload.from,
          replyTo: payload.replyTo, subject: payload.subject, preheader: payload.preheader });
        if (status.state === "accepted") await pool.query("select public.newsletter_delivery_complete($1,$2,$3,'accepted',$4)", [...ids, status.reference]);
        else await pool.query("select public.newsletter_delivery_fail($1,$2,$3,$4)", [...ids, status.state === "unknown"]);
      } catch {
        await pool.query("select public.newsletter_delivery_fail($1,$2,$3,true)", ids);
      }
    } catch { errors++; }
  }
  const { rows: [{ health }] } = await pool.query<{ health: { pending: number; unknown: number; failed: number } }>(
    "select public.newsletter_delivery_health() as health");
  if (errors || health.unknown || health.failed || health.pending) {
    options.log?.(JSON.stringify({ event: "newsletter_delivery_attention", errors, ...health }));
  }
  return { claimed: claimed.length, errors, ...health };
}
