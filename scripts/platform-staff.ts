import { createPool } from "../src/db/pool";
import { requiredEnv } from "../src/lib/env";

// Ops only. The one way a Harvest staff role is granted or revoked: there is no self-serve path and no UI. Runs as the migration owner (DATABASE_URL_UNPOOLED), the only role that can
// execute the grant and revoke functions; every change writes a staff audit row naming who ran it.
//   npx tsx scripts/platform-staff.ts grant <userId> <reviewer|admin> --by <your name>
//   npx tsx scripts/platform-staff.ts revoke <userId> --by <your name>
//   npx tsx scripts/platform-staff.ts list
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const pool = createPool(requiredEnv("DATABASE_URL_UNPOOLED"), 1);
try {
  const by = flag("--by");
  if (command === "grant") {
    const [user, role] = rest;
    if (!user || !by || (role !== "reviewer" && role !== "admin")) throw new Error("usage: grant <userId> <reviewer|admin> --by <name>");
    await pool.query("select public.platform_staff_grant($1, $2, $3)", [user, role, by]);
    console.info(`granted ${role} to ${user}`);
  } else if (command === "revoke") {
    const [user] = rest;
    if (!user || !by) throw new Error("usage: revoke <userId> --by <name>");
    const { rows } = await pool.query("select public.platform_staff_revoke($1, $2) as done", [user, by]);
    console.info(rows[0].done ? `revoked ${user}` : `${user} had no active role`);
  } else if (command === "list") {
    await pool.query("select set_config('app.platform_staff', 'on', false)");
    const { rows } = await pool.query("select user_id, role, granted_by, created_at, revoked_at from public.platform_staff order by created_at");
    console.table(rows);
  } else throw new Error("usage: grant | revoke | list");
} catch (error) { console.error(error instanceof Error ? error.message : "failed"); process.exitCode = 1; }
finally { await pool.end(); }
