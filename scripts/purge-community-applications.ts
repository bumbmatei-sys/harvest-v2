import { createPool } from "../src/db/pool";
// Retention (founder, 11 Nov): deletes declined and withdrawn community applications 90 days after the decision.
// Runs as the application role, which may only call the purge definer; schedule it daily alongside the jobs drain.
let pool: ReturnType<typeof createPool> | undefined;
try {
  pool = createPool(process.env.DATABASE_URL!);
  pool.on("error", () => console.error("community_purge_pool_failed"));
  const { rows: [role] } = await pool.query("select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  if (role?.current_user !== "harvest_app" || role.rolsuper || role.rolbypassrls) throw new Error("APPLICATION_ROLE_REQUIRED");
  const { rows: [{ removed }] } = await pool.query("select public.community_purge_applications() as removed");
  console.log(JSON.stringify({ removed }));
} catch { console.error("community_purge_failed"); process.exitCode = 1; }
finally { await pool?.end(); }
