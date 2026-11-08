import { sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { message } from "../i18n/messages";
import { syntheticIntakeEnabled } from "./connect-intake-mode";
import { AccessError } from "./permissions";
export function requireSyntheticIntake(){if(!syntheticIntakeEnabled())throw new AccessError(404,message("Intake.unavailable"));}
export async function withSyntheticIntake<T>(db:Database,run:(tx:Transaction)=>Promise<T>){
 requireSyntheticIntake();return db.transaction(async tx=>{await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);return run(tx);});
}
