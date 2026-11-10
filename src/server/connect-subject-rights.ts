import { retryConnectTransaction } from "./connect-retry";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { requireSyntheticIntake } from "./connect-intake-context";
import { AccessError } from "./permissions";
import { message } from "../i18n/messages";
import { withUser } from "./tenancy";
import { intakePurposes } from "../lib/connect-intake";
export const subjectRightsInput=z.object({handle:z.uuid(),action:z.enum(["withdraw","erase"]),purpose:z.enum(intakePurposes).optional()}).strict().refine(v=>v.action!=="withdraw"||v.purpose!==undefined);
export type SubjectResponse={handle:string;organizer:string;campaign:string;submittedAt:string;purposes:string[]};
export async function listSubjectResponses(db:Database,userId:string,after?:string){
 requireSyntheticIntake();const cursor=after?z.uuid().parse(after):null;
 return withUser(db,userId,async tx=>{
  await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);
  const result=await tx.execute<{items:SubjectResponse[]}>(sql`select public.connect_subject_responses(${cursor}::uuid) as items`);
  const items=result.rows[0]?.items??[];return {items:items.slice(0,20),next:items.length>20?items[19].handle:null};
 });
}
export async function applySubjectRights(db:Database,userId:string,raw:unknown){
 requireSyntheticIntake();const input=subjectRightsInput.parse(raw);
 return retryConnectTransaction(()=>withUser(db,userId,async tx=>{
  await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);
  const result=await tx.execute<{applied:boolean|null}>(sql`select public.connect_subject_rights(${input.handle}::uuid,${input.action},${input.purpose??null}) as applied`);
  if(result.rows[0]?.applied===null)throw new AccessError(429,message("Intake.limited"));
  // Generic acknowledgement avoids turning an opaque handle into an existence probe.
  return {acknowledged:true};
 }));
}
