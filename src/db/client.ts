import "server-only";
import { createPool } from "./pool";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { requiredEnv } from "../lib/env";
import { getRequestDb, type Database } from "./request";

export { withDb, type DatabaseEnvironment, type Database, type Transaction } from "./request";

let nodeDatabase: Database | undefined;

function makeNodeDatabase() {
  // Workers must enter through withDb with explicit bindings. Their Node
  // compatibility layer also exposes process, so its presence is insufficient.
  if (globalThis.navigator?.userAgent === "Cloudflare-Workers" || "WebSocketPair" in globalThis ||
      typeof process === "undefined" || process.release?.name !== "node") {
    throw new Error("DATABASE_REQUEST_SCOPE_REQUIRED");
  }
  const pool = createPool(requiredEnv("DATABASE_URL"));
  pool.on("error", () => console.error("database_pool_error"));
  return drizzle(pool, { schema });
}

export function getDb(): Database {
  return getRequestDb() ?? (nodeDatabase ??= makeNodeDatabase());
}
