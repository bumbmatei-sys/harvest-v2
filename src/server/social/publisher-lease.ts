import { sql } from "drizzle-orm";
import { runtimeConnectionString, withDb, type DatabaseEnvironment } from "../../db/request";

const claimQuery = "select public.social_publish_claim($1, $2) as claimed";

/**
 * Test-only coordination for grouped, fake posts using the existing 0069 lease.
 * Connection ownership is per database call. A claim is committed before the
 * publisher sees it, and later operations can run on different connections.
 */
export function fakePublisherLease(env: DatabaseEnvironment, mode: string | undefined) {
  if (mode !== "test" || env.role !== "worker") throw new Error("LOCAL_FAKE_PUBLISHER_REQUIRED");
  const connectionString = runtimeConnectionString(env.runtime === "node" ? env.pool.options.connectionString
    : env.WORKER_HYPERDRIVE?.connectionString, "worker");
  if (!["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname)) throw new Error("LOCAL_FAKE_PUBLISHER_REQUIRED");

  return {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
      if (text !== claimQuery) return withDb(env, (_db, connection) => connection.query<R>(text, values));

      return withDb(env, (db) => db.transaction(async (tx) => {
        const result = await tx.execute<{ claimed: { provider: string; delivery: unknown }[] }>(
          sql`select public.social_publish_claim(1, 300) as claimed`);
        const claims = result.rows[0]?.claimed;
        if (!Array.isArray(claims) || claims.some((claim) => claim.provider !== "fake" || claim.delivery == null)) {
          // Grouped posts move to unknown on an expired in-flight lease. The
          // legacy single-post path may requeue, so it stays on the Node CLI.
          throw new Error("GROUPED_FAKE_PUBLISHER_REQUIRED");
        }
        return { rows: result.rows as unknown as R[] };
      }));
    },
  };
}
