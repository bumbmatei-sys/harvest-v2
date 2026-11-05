import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { createPool } from "../src/db/pool";
import * as schema from "../src/db/schema";
import { drainJobs, replayJob } from "../src/server/jobs/service";

// Explicit local operator tool. No automatic .env loading and no cloud setup.
// The user ID comes from this trusted operator, never an HTTP request.
const [user, tenantId, command = "drain", argument] = process.argv.slice(2);
const options = z.object({ user: z.string().min(1), tenantId: z.uuid(), command: z.enum(["drain", "replay"]) }).safeParse({ user, tenantId, command });
const connectionString = process.env.DATABASE_URL;
if (!options.success || !connectionString) {
  console.error("Usage: DATABASE_URL=<application role URL> npm run jobs:drain -- <operator-user-id> <workspace-uuid> [drain [1..100] | replay <job-uuid>]");
  process.exitCode = 1;
} else {
  const pool = createPool(connectionString);
  pool.on("error", () => console.error("jobs_database_pool_error"));
  try {
    // Fail closed if an owner/superuser connection would bypass queue RLS.
    const { rows: [role] } = await pool.query("select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    if (role?.current_user !== "harvest_app" || role.rolsuper || role.rolbypassrls) throw new Error("APPLICATION_ROLE_REQUIRED");
    const db = drizzle(pool, { schema });
    const result = command === "replay"
      ? await replayJob(db, user, tenantId, z.uuid().parse(argument))
      : await drainJobs(db, user, tenantId, `local:${randomUUID()}`, z.coerce.number().int().min(1).max(100).parse(argument ?? 50));
    console.info(JSON.stringify(result));
  } catch { console.error("jobs_command_failed"); process.exitCode = 1; }
  finally { await pool.end(); }
}
