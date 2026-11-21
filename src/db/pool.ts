import { Pool as PgPool } from "pg";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";

// Neon's WebSocket transport supports interactive transactions over HTTPS, including
// environments where raw PostgreSQL TLS connections cannot complete.
neonConfig.webSocketConstructor = WebSocket;
export function createPool(connectionString: string, max = 5): PgPool {
  if (new URL(connectionString).hostname.endsWith(".neon.tech")) {
    // Neon implements node-postgres's Pool/query/transaction protocol. The cast
    // bridges separate copies of pg's type declarations; runtime behavior is tested.
    return new NeonPool({ connectionString, max, connectionTimeoutMillis: 15_000 }) as unknown as PgPool;
  }
  return new PgPool({ connectionString, max, connectionTimeoutMillis: 15_000 });
}
