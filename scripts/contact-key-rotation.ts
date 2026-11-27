import { createPool } from "../src/db/pool";
import { rotateStagedContacts } from "../src/server/contact-envelope-rotation";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";

const mode = process.argv[2] ?? "check";
if (process.env.HARVEST_CONTACT_ROTATION_ENABLED === "1" && process.env.NODE_ENV !== "production" &&
    process.env.HARVEST_ENV !== "production" && process.env.VERCEL_ENV !== "production") {
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    if (mode !== "run" && mode !== "check") throw new Error("CONTACT_ROTATION_USAGE");
    pool = createPool(workerDatabaseUrl(process.env));
    await requireWorkerRole(pool);
    const result = await rotateStagedContacts(pool, {
      CONTACT_KEK_V1: process.env.CONTACT_KEK_V1, CONTACT_KEK_V2: process.env.CONTACT_KEK_V2,
    }, mode);
    console.info(result);
    if (result.failed || result.remaining) process.exitCode = 1;
  } catch {
    console.error("contact_key_rotation_failed");
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
