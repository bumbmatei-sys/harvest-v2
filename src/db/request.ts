import { sharedScope } from "../lib/shared-scope";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client, type Pool, type QueryConfig } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseRole = "app" | "worker";
type HyperdriveBinding = { connectionString: string };
export type DatabaseEnvironment =
  | { runtime: "node"; role: DatabaseRole; pool: Pool; database?: string }
  | { runtime: "workers"; role: DatabaseRole; APP_HYPERDRIVE?: HyperdriveBinding; WORKER_HYPERDRIVE?: HyperdriveBinding; database?: string };

const roleNames = { app: "harvest_app", worker: "harvest_worker" } as const;
const requestDatabase = sharedScope<Database>("request-database");
const transactionDatabase = sharedScope<Database>("transaction-database");

export function getRequestDb() {
  return requestDatabase.getStore();
}

// A deployed Hyperdrive binding carries generated credentials and a generated database name, not the origin's (CF-02 staging, 26 Nov).
// Its URL can only rule out the other Harvest logins; verifyRole checks the real origin principal and database after connecting.
export function runtimeConnectionString(value: string | undefined, role: DatabaseRole, source: "direct" | "hyperdrive" = "direct"): string {
  try {
    if (value) {
      const url = new URL(value);
      const user = decodeURIComponent(url.username);
      if (["postgresql:", "postgres:"].includes(url.protocol) && url.hostname && url.pathname.length > 1 &&
          (user === roleNames[role] || (source === "hyperdrive" && user !== "" && !user.startsWith("harvest_"))) &&
          !["user", "host", "port", "options"].some((key) => url.searchParams.has(key))) return value;
    }
  } catch {
    // Parsing errors may include the URL and must never leave this boundary.
  }
  throw new Error("DATABASE_URL_INVALID");
}

async function verifyRole(client: Pick<Client, "query">, role: DatabaseRole, database: string | undefined) {
  // Bindings can be misprovisioned even with a valid URL. Check the connected
  // principal before handing out a handle. Do not select or switch roles.
  const { rows: [result] } = await client.query<{ allowed: boolean }>(`
    select session_user = current_user and current_user = $1 and ($2::text is null or current_database() = $2)
      and not (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolinherit or r.rolreplication)
      and not exists (select 1 from pg_catalog.pg_auth_members where member = r.oid)
      and not exists (select 1 from pg_catalog.pg_database where datname = current_database() and datdba = r.oid)
      and not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relowner = r.oid)
      and not exists (select 1 from pg_catalog.pg_namespace where nspname = 'public' and nspowner = r.oid)
      and not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proowner = r.oid)
      as allowed
    from pg_catalog.pg_roles r where r.rolname = current_user`, [roleNames[role], database ?? null]);
  if (!result?.allowed) throw new Error("DATABASE_PRINCIPAL_INVALID");
}

export async function withDb<T>(env: DatabaseEnvironment, run: (db: Database, connection: Pick<Client, "query">) => Promise<T>,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  if (env.runtime !== "node" && env.runtime !== "workers") throw new Error("DATABASE_RUNTIME_INVALID");
  if (env.role !== "app" && env.role !== "worker") throw new Error("DATABASE_ROLE_INVALID");
  const deadline = timeoutMs ?? (env.runtime === "workers" ? 15_000 : undefined);
  const cancellation = new AbortController();
  const abort = () => cancellation.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = deadline === undefined ? undefined : setTimeout(() => {
    cancellation.abort(new DOMException("DATABASE_REQUEST_TIMEOUT", "TimeoutError"));
  }, deadline);
  let close: ((discard: boolean) => Promise<void> | void) | undefined;
  let finished = false;
  let tail = Promise.resolve();
  let pending = 0;
  let rejectOnAbort: (() => void) | undefined;
  try {
    cancellation.signal.throwIfAborted();
    const cancelled = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(cancellation.signal.reason);
      cancellation.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    const acquired = (async () => {
      if (env.runtime === "node") {
        const client = await env.pool.connect();
        // The shared pool can deliver a checkout after the caller's deadline.
        if (cancellation.signal.aborted || finished) {
          client.release(true);
          cancellation.signal.throwIfAborted();
          throw new Error("DATABASE_REQUEST_ENDED");
        }
        const onError = (error: Error) => cancellation.abort(error);
        client.on("error", onError);
        close = (discard) => {
          client.release(discard);
          client.removeListener("error", onError);
        };
        return client;
      }
      const binding = env.role === "app" ? env.APP_HYPERDRIVE : env.WORKER_HYPERDRIVE;
      const connectionString = runtimeConnectionString(binding?.connectionString, env.role, "hyperdrive");
      const client = new Client({ connectionString, connectionTimeoutMillis: 15_000 });
      // Query errors reach the caller. Handle socket errors emitted between queries.
      client.on("error", (error) => cancellation.abort(error));
      close = () => client.end();
      await client.connect();
      return client;
    })();
    const client = await Promise.race([acquired, cancelled]);
    await Promise.race([verifyRole(client, env.role, env.database), cancelled]);

    // A pg connection can carry only one transaction at a time. Queue root
    // queries and whole transactions so parallel callers cannot interleave them.
    const checkOpen = () => {
      cancellation.signal.throwIfAborted();
      if (finished) throw new Error("DATABASE_REQUEST_ENDED");
    };
    const schedule = <R>(operation: () => Promise<R>): Promise<R> => {
      if (transactionDatabase.getStore() === db) return Promise.reject(new Error("DATABASE_USE_TRANSACTION_HANDLE"));
      pending += 1;
      const result = tail.then(() => {
        checkOpen();
        return operation();
      }).finally(() => { pending -= 1; });
      tail = result.then(() => undefined, () => undefined);
      return result;
    };
    // Drizzle and the worker runners use the promise-based pg query protocol.
    const connection = {
      query: ((query: string | QueryConfig, values?: unknown[]) => schedule(() => client.query(query, values))) as Client["query"],
    };
    const db: Database = drizzle(connection as Client, { schema });
    db.transaction = (work, config) => schedule(async () => {
      let active = true;
      const transactionDb = drizzle({
        query: (query: QueryConfig, values?: unknown[]) => {
          checkOpen();
          if (!active) throw new Error("DATABASE_TRANSACTION_ENDED");
          return client.query(query, values);
        },
      } as Client, { schema });
      try {
        return await transactionDb.transaction((tx) => transactionDatabase.run(db, work, tx), config);
      } finally {
        active = false;
      }
    });
    const result = await Promise.race([requestDatabase.run(db, run, db, connection), cancelled]);
    if (pending) throw new Error("DATABASE_WORK_PENDING");
    finished = true;
    await close?.(false);
    close = undefined;
    return result;
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (rejectOnAbort) cancellation.signal.removeEventListener("abort", rejectOnAbort);
    await close?.(true);
  }
}
