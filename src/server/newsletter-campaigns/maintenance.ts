import type { Pool } from "pg";
import { requireWorkerRole } from "../worker-role";
import type { FakeNewsletterProvider } from "./fake-provider";
import type { DomainRecord } from "./port";
import { newsletterWorkerEnabled } from "./worker";

type DomainCheck = { tenant_id: string; id: string; domain: string; records: DomainRecord[]; check_revision: string };

export async function recheckNewsletterDomains(pool: Pool, env: NodeJS.ProcessEnv,
  provider: Pick<FakeNewsletterProvider, "domain">, limit = 20) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_DOMAIN_RECHECK_ENABLED")) return null;
  await requireWorkerRole(pool);
  const { rows } = await pool.query<DomainCheck>("select * from public.newsletter_domains_due($1)", [limit]);
  let checked = 0;
  for (const domain of rows) {
    const status = await provider.domain(domain.domain, domain.records);
    const result = await pool.query<{ checked: boolean }>(
      "select public.newsletter_domain_check($1,$2,$3,$4,$5,$6,$7,$8) as checked",
      [domain.tenant_id, domain.id, domain.check_revision, status?.ownership, status?.spf, status?.dkim, status?.bounce, status?.dmarc],
    );
    checked += Number(result.rows[0].checked);
  }
  return { checked };
}

export async function purgeNewsletterDeliveries(pool: Pool, env: NodeJS.ProcessEnv, limit = 250) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_RETENTION_ENABLED")) return null;
  await requireWorkerRole(pool);
  const { rows: [result] } = await pool.query<{ purged: number }>("select public.newsletter_purge_deliveries($1) as purged", [limit]);
  return result;
}

/**
 * Takes today's (UTC) audience counts for up to `limit` ministries per batch: counts only, no person ids. Idempotent per ministry per day.
 * Runs as the worker login behind the daily maintenance flag, in bounded batches until every ministry has today's row.
 */
export async function snapshotNewsletterAudience(pool: Pool, env: NodeJS.ProcessEnv, limit = 100, maxBatches = 20) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_RETENTION_ENABLED")) return null;
  await requireWorkerRole(pool);
  let taken = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const { rows: [result] } = await pool.query<{ taken: number }>("select public.newsletter_snapshot_audience($1) as taken", [limit]);
    taken += result.taken;
    if (result.taken < limit) break;
  }
  return { taken };
}

/** Click rows older than 90 days become anonymous campaign/day/link counts; the same command and flag as the delivery purge. */
export async function purgeNewsletterClicks(pool: Pool, env: NodeJS.ProcessEnv, limit = 1000) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_RETENTION_ENABLED")) return null;
  await requireWorkerRole(pool);
  const { rows: [result] } = await pool.query<{ purged: number }>("select public.newsletter_purge_clicks($1) as purged", [limit]);
  return result;
}

/** Automation click rows older than 90 days become anonymous automation/step/day/link counts; the same command and flag as the delivery purge. */
export async function purgeNewsletterAutomationClicks(pool: Pool, env: NodeJS.ProcessEnv, limit = 1000) {
  if (!newsletterWorkerEnabled(env, "HARVEST_NEWSLETTER_RETENTION_ENABLED")) return null;
  await requireWorkerRole(pool);
  const { rows: [result] } = await pool.query<{ purged: number }>("select public.newsletter_purge_automation_clicks($1) as purged", [limit]);
  return result;
}
