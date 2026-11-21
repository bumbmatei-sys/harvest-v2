import "server-only";
import { createPool } from "./pool";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { requiredEnv } from "../lib/env";
import { getRequestDb, runtimeConnectionString, type Database, type DatabaseRole } from "./request";

export { withDb, type DatabaseEnvironment, type Database, type Transaction } from "./request";

const nodePools: Partial<Record<DatabaseRole, ReturnType<typeof createPool>>> = {};
let nodeDatabase: Database | undefined;

export function nodeDbEnvironment(role: DatabaseRole = "app") {
  // Workers must enter through withDb with explicit bindings. Their Node
  // compatibility layer also exposes process, so its presence is insufficient.
  if (globalThis.navigator?.userAgent === "Cloudflare-Workers" || "WebSocketPair" in globalThis ||
      typeof process === "undefined" || process.release?.name !== "node") {
    throw new Error("DATABASE_REQUEST_SCOPE_REQUIRED");
  }
  const pool = nodePools[role] ??= createPool(runtimeConnectionString(
    requiredEnv(role === "app" ? "DATABASE_URL" : "WORKER_DATABASE_URL"), role,
  )).on("error", () => console.error("database_pool_error"));
  return { runtime: "node", role, pool } as const;
}

export function getDb(): Database {
  return getRequestDb() ?? (nodeDatabase ??= drizzle(nodeDbEnvironment().pool, { schema }));
}
