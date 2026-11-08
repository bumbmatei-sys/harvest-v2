import { appendFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { createPool } from "../src/db/pool";
import * as schema from "../src/db/schema";
import { dispatchInvitation } from "../src/server/connect-invitations";
import { requireSyntheticIntake } from "../src/server/connect-intake-context";
import { message } from "../src/i18n/messages";
let pool:ReturnType<typeof createPool>|undefined;
try {
 requireSyntheticIntake();
 const path=process.env.HARVEST_CONNECT_TEST_MAILBOX;
 const base=new URL(process.env.BETTER_AUTH_URL??"");
 if(!path||!["localhost","127.0.0.1"].includes(base.hostname))throw new Error("TEST_MAILBOX_REQUIRED");
 pool=createPool(process.env.DATABASE_URL!);pool.on("error",()=>console.error("connect_dispatch_pool_failed"));
 const {rows:[role]}=await pool.query("select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user");
 if(role?.current_user!=="harvest_app"||role.rolsuper||role.rolbypassrls)throw new Error("APPLICATION_ROLE_REQUIRED");
 const db=drizzle(pool,{schema});let sent=0;
 for(let n=0;n<50;n++){
  const outcome=await dispatchInvitation(db,async mail=>{
   const url=new URL("/connect/claim",base);url.hash=`token=${mail.token}`;
   // Operator-invoked LOCAL mock mailbox only; never an application HTTP route or provider bypass.
   await appendFile(path,JSON.stringify({to:mail.to,text:message("Invitations.emailBody",{url:url.href}),idempotencyKey:mail.idempotencyKey})+"\n",{mode:0o600});
  });
  if(outcome.status==="idle")break;if(outcome.status==="sent")sent++;
 }
 console.log(JSON.stringify({sent}));
}catch{console.error("connect_dispatch_failed");process.exitCode=1;}
finally{await pool?.end();}
