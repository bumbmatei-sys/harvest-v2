import { createPool } from "../src/db/pool";
import { qaDatabaseAllowed } from "../src/server/qa-database-allowlist";
import { seedQaData } from "./qa-seed-data";

let pool: ReturnType<typeof createPool> | undefined;
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--reset")) throw new Error("QA_SEED_USAGE");
  const { DATABASE_URL: url, NODE_ENV, VERCEL_ENV } = process.env;
  if (!url || NODE_ENV === "production" || VERCEL_ENV === "production" || !qaDatabaseAllowed(url, "preview")) {
    throw new Error("QA_SEED_INVALID_TARGET");
  }
  pool = createPool(url, 1);
  pool.on("error", () => console.error("QA_SEED_POOL_FAILED"));
  console.log(JSON.stringify(await seedQaData(pool, args.includes("--reset"))));
} catch (error) {
  const reason = error instanceof Error && /^QA_SEED_[A-Z_]+$/.test(error.message) ? error.message : "QA_SEED_FAILED";
  console.error(reason);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
