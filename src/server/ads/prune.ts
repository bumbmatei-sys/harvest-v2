type Pool = { query<R extends Record<string, unknown>>(query: string, values: unknown[]): Promise<{ rows: R[] }> };
/** Retention for results: rows older than 400 UTC days are removed in bounded batches by the worker role. No schedule is installed. */
export async function pruneAdsResults(pool: Pool, limit = 500) {
  const { rows: [row] } = await pool.query<{ removed: number }>("select public.ads_results_prune($1) as removed", [limit]);
  return row.removed;
}
