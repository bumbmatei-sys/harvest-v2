import { newsletterUnsubscribeLink, newsletterFileLink } from "../../lib/site-address";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { renderNewsletter } from "../../lib/newsletter-content";
import { clickRewriter, clickUrl, linkCollector } from "../../lib/newsletter-click-token";
import { newsletterKey, signNewsletterPreference } from "../newsletter-public";
import { formatFromHeader } from "../../lib/email-address";
import { requireWorkerRole } from "../worker-role";
import { newsletterOrigin } from "./access";
import { FakeNewsletterProvider } from "./fake-provider";
import { newsletterSuppressionKeys } from "./suppression-keys";
import { LIVE_NEWSLETTER_ENABLED } from "./ses-adapter";

type DeliveryHealth = { pending: number; unknown: number; failed: number; operatorReview: number;
  unresolvedByMinistry: { ministryId: string; unknown: number; operatorReview: number; oldestUnknownAgeSeconds: number }[] };
type Claimed = { tenant: string; key: string; lease: string };
type CampaignScope = { tenantId: string; id: string };
const claimQuery = "select public.newsletter_delivery_claim($1,$2) as claimed";

async function claimDeliveries(pool: Pool, limit: number, seconds: number, campaign?: CampaignScope) {
  if (!campaign) return (await pool.query<{ claimed: Claimed[] }>(claimQuery, [limit, seconds])).rows[0].claimed;
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query("begin");
    await client.query("select set_config('app.qa_newsletter_campaign',$1::uuid::text||'/'||$2::uuid::text,true) is not null", [campaign.tenantId, campaign.id]);
    const { rows: [{ claimed }] } = await client.query<{ claimed: Claimed[] }>(claimQuery, [limit, seconds]);
    await client.query("commit");
    return claimed;
  } catch (error) {
    await client.query("rollback").catch(() => { destroy = true; });
    throw error;
  } finally {
    client.release(destroy);
  }
}

type Authorized = { email: string; firstName: string; ministryName: string; from: string; fromName?: string | null; replyTo: string;
  subject: string; preheader: string | null; content: unknown; images: string[];
  campaignId: string; revision: number; clickTracking: boolean };

export function newsletterWorkerEnabled(env: Record<string, string | undefined>, flag: string) {
  return !LIVE_NEWSLETTER_ENABLED && env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" &&
    (env.NODE_ENV === "test" || env.NODE_ENV === "development") && env[flag] === "1";
}

export async function runNewsletterWorker(pool: Pool, env: NodeJS.ProcessEnv, provider: FakeNewsletterProvider,
  options: { limit?: number; leaseSeconds?: number; campaign?: CampaignScope; beforeAuthorize?: () => Promise<void>;
    log?: (metadata: string) => void } = {}) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_WORKER_ENABLED")) return null;
  const key = newsletterKey(env);
  if (!key) throw new Error("NEWSLETTER_CREDENTIAL_UNAVAILABLE");
  const suppressionKeys = newsletterSuppressionKeys(env);
  await requireWorkerRole(pool);
  const origin = newsletterOrigin();
  const claimed = await claimDeliveries(pool, options.limit ?? 20, options.leaseSeconds ?? 120, options.campaign);
  let errors = 0;
  for (const job of claimed) {
    try {
      const ids = [job.tenant, job.key, job.lease];
      const nonce = randomBytes(32).toString("base64url");
      const unsubscribe = newsletterUnsubscribeLink(signNewsletterPreference(key, "list", nonce));
      await options.beforeAuthorize?.();
      const client = await pool.connect();
      let destroy = false;
      let payload: Authorized | null;
      try {
        await client.query("begin");
        await client.query("select set_config('app.nl_suppression_keys',$1,true) is not null", [suppressionKeys]);
        const { rows } = await client.query<{ payload: Authorized | null }>(
          "select public.newsletter_delivery_authorize($1,$2,$3,$4) as payload", [...ids, nonce]);
        payload = rows[0].payload;
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => { destroy = true; });
        throw error;
      } finally {
        // pg releases a healthy client normally. On rollback errors destroy the connection.
        client.release(destroy);
      }
      if (!payload) continue;
      const images = new Map(payload.images.map(fileId => [fileId, newsletterFileLink(job.tenant, fileId)]));
      const context = { preheader: payload.preheader, firstName: payload.firstName, ministryName: payload.ministryName, unsubscribe: unsubscribe.href, images };
      let message;
      try {
        // Click counting: a first pass collects the content links (never the unsubscribe link), the frozen revision's list is stored, then each
        // link is rewritten to a signed redirect that carries only references. Off, or with nothing stored, the message keeps its links as written.
        let track: ((url: string) => string) | undefined;
        if (payload.clickTracking) {
          const collector = linkCollector();
          renderNewsletter(payload.content, { ...context, track: collector.track });
          const { rows: [{ links }] } = await pool.query<{ links: string[] | null }>(
            "select public.newsletter_click_links_store($1,$2,$3,$4::text[]) as links", [...ids, collector.seen]);
          if (links) track = clickRewriter(links, link => clickUrl(origin, key, { tenant: job.tenant, campaign: payload!.campaignId,
            revision: payload!.revision, delivery: job.key, link }));
        }
        message = renderNewsletter(payload.content, { ...context, track, clicksCounted: Boolean(track) });
      } catch {
        await pool.query("select public.newsletter_delivery_fail($1,$2,$3,false)", ids);
        continue;
      }
      // No DB transaction spans the submission. Once authorized, loss of the receipt is ambiguous.
      try {
        const status = await provider.submit({ ...message, deliveryId: job.key, to: payload.email, from: formatFromHeader(payload.fromName, payload.from),
          replyTo: payload.replyTo, subject: payload.subject, preheader: payload.preheader });
        if (status.state === "accepted") await pool.query("select public.newsletter_delivery_complete($1,$2,$3,'accepted',$4)", [...ids, status.reference]);
        else await pool.query("select public.newsletter_delivery_fail($1,$2,$3,$4)", [...ids, status.state === "unknown"]);
      } catch {
        await pool.query("select public.newsletter_delivery_fail($1,$2,$3,true)", ids);
      }
    } catch { errors++; }
  }
  const markedForReview = options.campaign ? 0 : (await pool.query<{ markedForReview: number }>(
    'select public.newsletter_mark_unknown_for_review(250) as "markedForReview"')).rows[0].markedForReview;
  const { rows: [{ health }] } = await pool.query<{ health: DeliveryHealth }>(
    "select public.newsletter_delivery_health() as health");
  if (errors || health.unknown || health.operatorReview || health.failed || health.pending) {
    options.log?.(JSON.stringify({ event: "newsletter_delivery_attention", errors, markedForReview, ...health }));
  }
  return { claimed: claimed.length, errors, markedForReview, ...health };
}
