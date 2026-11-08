import { drizzle } from "drizzle-orm/node-postgres";
import { createPool } from "../src/db/pool";
import * as schema from "../src/db/schema";
import { purgeInvitations } from "../src/server/connect-invitations";
import { purgeIntake, requireSyntheticIntake } from "../src/server/connect-intake";
let pool: ReturnType<typeof createPool> | undefined;
try {
  requireSyntheticIntake();pool=createPool(process.env.DATABASE_URL!);
  pool.on("error",()=>console.error("connect_purge_pool_failed"));
  const {rows:[role]}=await pool.query("select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user");
  if(role?.current_user!=="harvest_app"||role.rolsuper||role.rolbypassrls)throw new Error("APPLICATION_ROLE_REQUIRED");
  const db=drizzle(pool,{schema});await purgeInvitations(db);console.log(JSON.stringify(await purgeIntake(db)));
} catch { console.error("connect_purge_failed");process.exitCode=1; }
finally { await pool?.end(); }
