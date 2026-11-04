import "server-only";
import { createPool } from "./pool";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { requiredEnv } from "../lib/env";
let database: ReturnType<typeof makeDatabase> | undefined;
function makeDatabase() {
  const pool = createPool(requiredEnv("DATABASE_URL"));
  pool.on("error", () => console.error("database_pool_error"));
  return drizzle(pool, { schema });
}
export function getDb() { return database ??= makeDatabase(); }
export type Database = ReturnType<typeof getDb>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
