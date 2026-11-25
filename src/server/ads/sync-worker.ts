import { deriveRatios, projectResults, type AdLevel } from "../../lib/ads/ads";
import { credentialBinding, openCredential } from "../social/credential-envelope";
import { AdsProviderError, type AdsProvider } from "./port";
import { ADS_RESULTS_SYNC_ENABLED } from "./registry";

// Scheduled results sync. Runs as the harvest_worker role through two narrow definer functions (claim, apply); the provider is called between them with no transaction open. Hard-off
// (ADS_RESULTS_SYNC_ENABLED = false) and no schedule is installed: nothing calls this, and the SQL claim only ever leases fake-provider connections.
type Pool = { query<R extends Record<string, unknown>>(query: string, values: unknown[]): Promise<{ rows: R[] }> };
type Claim = { tenantId: string; adAccountId: string; adAccountRef: string; connectionId: string; accountRef: string; envelope: unknown; lease: string; failures: number };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export async function runAdsResultsSync(pool: Pool, fake: AdsProvider & { id: "fake" }, options: { enabled?: boolean; limit?: number; now?: () => Date } = {}) {
  if (!(options.enabled ?? ADS_RESULTS_SYNC_ENABLED)) return { disabled: true as const, claimed: 0, synced: 0, failed: 0, written: 0 };
  if (fake.id !== "fake") throw new Error("ADS_SYNC_WORKER_UNAVAILABLE");
  const now = (options.now ?? (() => new Date()))().getTime();
  const { rows: [{ jobs }] } = await pool.query<{ jobs: Claim[] }>("select public.ads_sync_claim($1) as jobs", [options.limit ?? 5]);
  const out = { disabled: false as const, claimed: jobs.length, synced: 0, failed: 0, written: 0 };
  for (const job of jobs) {
    let state: "ready" | "failing" | "delayed" = "ready", delay = 86_400; const rows: { level: AdLevel; ref: string; day: string; metrics: Record<string, number> }[] = [];
    try {
      const credential = openCredential(job.envelope, credentialBinding(job.tenantId, job.connectionId));
      for (const level of ["campaign", "adset", "ad"] as const) {
        const read = await fake.readResults(credential, { accountRef: job.accountRef, adAccountRef: job.adAccountRef, level, from: day(now - 7 * DAY), to: day(now), attributionModel: "default" });
        for (const row of read.rows.slice(0, 1_500)) rows.push({ level, ref: row.ref, day: row.day, metrics: deriveRatios(projectResults(row.metrics)) as Record<string, number> });
      }
    } catch (error) {
      state = error instanceof AdsProviderError && error.code === "RATE_LIMITED" ? "delayed" : "failing";
      delay = Math.min(86_400, Math.max(600, 600 * 2 ** Math.min(job.failures, 7), error instanceof AdsProviderError && error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : 0));
    }
    const { rows: [{ written }] } = await pool.query<{ written: number }>("select public.ads_sync_apply($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb) as written", [job.tenantId, job.adAccountId, job.lease, state, delay, JSON.stringify(rows)]);
    if (written < 0) continue; // the lease was lost: another run owns the account now
    if (state === "ready") { out.synced++; out.written += written; } else out.failed++;
  }
  return out;
}
