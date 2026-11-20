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
