import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { publicFilePath } from "../lib/files";
import { renderNewsletter } from "../lib/newsletter-content";
import { newsletterKey, signNewsletterPreference } from "./newsletter-public";
import { requireWorkerRole } from "./worker-role";
import { newsletterOrigin } from "./newsletter-campaigns/access";
import { FakeNewsletterProvider } from "./newsletter-campaigns/fake-provider";
import { newsletterSuppressionKeys } from "./newsletter-campaigns/suppression-keys";
import { newsletterWorkerEnabled } from "./newsletter-campaigns/worker";

type Job = { tenant: string; run: string; lease: string };
type Authorized = { attempt: string; email: string; firstName: string; ministryName: string; subject: string; preheader: string | null; content: unknown; images: string[] };
const syntheticSender = "automations@newsletter.example.test";

export const automationsWorkerFlag = "HARVEST_NEWSLETTER_AUTOMATIONS_WORKER_ENABLED";

/**
 * One tick of the automations worker. Delivery goes through the synthetic provider only (the worker is off unless a development or test flag is set, and
 * never runs in production). Consent is re-checked in the database immediately before every send; a run that fails the check stops without sending.
 */
export async function runNewsletterAutomations(pool: Pool, env: NodeJS.ProcessEnv, provider: FakeNewsletterProvider, options: { limit?: number; leaseSeconds?: number } = {}) {
  if (!newsletterWorkerEnabled(env, automationsWorkerFlag) || env.HARVEST_NEWSLETTER_AUTOMATIONS !== "1") return null;
  const key = newsletterKey(env);
  if (!key) throw new Error("NEWSLETTER_CREDENTIAL_UNAVAILABLE");
  const suppressionKeys = newsletterSuppressionKeys(env);
  await requireWorkerRole(pool);
  const origin = newsletterOrigin();
  const { rows: [{ jobs }] } = await pool.query<{ jobs: Job[] }>("select public.newsletter_automation_tick($1,$2) as jobs", [options.limit ?? 50, options.leaseSeconds ?? 120]);
  let sent = 0, stopped = 0, failed = 0;
  for (const job of jobs) {
    const nonce = randomBytes(32).toString("base64url");
    const unsubscribe = new URL("/api/newsletter/unsubscribe", origin);
    unsubscribe.searchParams.set("token", signNewsletterPreference(key, "list", nonce));
    const client = await pool.connect();
    let payload: Authorized | null = null, destroy = false;
    try {
      await client.query("begin");
      await client.query("select set_config('app.nl_suppression_keys',$1,true) is not null", [suppressionKeys]);
      payload = (await client.query<{ payload: Authorized | null }>("select public.newsletter_automation_authorize($1,$2,$3,$4) as payload", [job.tenant, job.run, job.lease, nonce])).rows[0].payload;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => { destroy = true; });
      throw error;
    } finally { client.release(destroy); }
    if (!payload) { stopped++; continue; }
    let state: "accepted" | "failed" | "unknown" = "failed", reference: string | null = null;
    try {
      const images = new Map(payload.images.map((fileId) => [fileId, new URL(publicFilePath(job.tenant, fileId), origin).href]));
      const rendered = renderNewsletter(payload.content, { preheader: payload.preheader, firstName: payload.firstName, ministryName: payload.ministryName, unsubscribe: unsubscribe.href, images });
      const status = await provider.submit({ ...rendered, deliveryId: payload.attempt, to: payload.email, from: syntheticSender, replyTo: syntheticSender,
        subject: payload.subject, preheader: payload.preheader });
      if (status.state === "accepted") { state = "accepted"; reference = status.reference; } else state = status.state;
    } catch { state = "failed"; }
    await pool.query("select public.newsletter_automation_finish($1,$2,$3,$4,$5)", [job.tenant, job.run, payload.attempt, state, reference]);
    if (state === "accepted") sent++; else failed++;
  }
  return { claimed: jobs.length, sent, stopped, failed };
}
