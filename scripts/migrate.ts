import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createPool } from "../src/db/pool";
import { readFile } from "node:fs/promises";
import { requiredEnv } from "../src/lib/env";
if (process.env.CI !== "true") {
  if (!process.argv.includes("--dev")) throw new Error("Migrations run in CI only, except the explicitly authorized --dev verification.");
  process.loadEnvFile(".env.local");
  const metadata = JSON.parse(await readFile("docs/setup/neon-project.json", "utf8"));
  if (metadata.projectName !== "harvest-v2" || new URL(requiredEnv("DATABASE_URL_UNPOOLED")).hostname !== metadata.devEndpointHost) throw new Error("Dev database identity does not match harvest-v2 metadata.");
}
const pool = createPool(requiredEnv("DATABASE_URL_UNPOOLED"), 1);
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.info("Drizzle migrations applied successfully");
} catch (error) { console.error("Migration failed", error && typeof error === "object" && "code" in error ? error.code : "connection_or_query_error"); process.exitCode = 1; }
finally { await pool.end(); }
