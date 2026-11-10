import { retryConnectTransaction } from "./connect-retry";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/schema";
import type { Database, Transaction } from "../db/client";
import { requireSyntheticIntake, withSyntheticIntake } from "./connect-intake-context";
import { invitationRecipientHash, openIntake, receiptHash, sealIntake } from "./connect-intake-crypto";
import { withUser } from "./tenancy";
import { AccessError } from "./permissions";
import { message } from "../i18n/messages";
import { backoffMs } from "./jobs/primitives";

const secret=z.string().regex(/^[a-f0-9]{64}$/);
export const invitationRequest=z.object({receiptToken:secret}).strict();
export const invitationPrepare=z.object({token:secret}).strict();
export const invitationClaim=z.object({action:z.enum(["confirm","decline"])}).strict();
const randomSecret=()=>randomBytes(32).toString("hex");
const unavailable=()=>new AccessError(409,message("Invitations.unavailable"));
export type InvitationSender=(mail:{to:string;token:string;idempotencyKey:string;signal?:AbortSignal})=>Promise<void>;
type Envelope=ReturnType<typeof sealIntake>;
type Reserved={id:string;tenant:string;generation:number;attempt:number;envelope:Envelope;receiptHash:string;tokenHash:string};

export async function enqueueInvitation(tx:Transaction,hash:string,email:string,resend=false) {
 const token=randomSecret(),envelope=sealIntake({email,token},`invitation:${hash}:${receiptHash(token)}`);
 const r=await tx.execute<{outcome:string}>(sql`select public.connect_invitation_enqueue(${hash},${receiptHash(token)},${invitationRecipientHash(email,receiptHash(token))},${JSON.stringify(envelope)}::jsonb,${resend}) as outcome`);
 return r.rows[0]?.outcome;
}
export async function requestInvitation(db:Database,raw:unknown) {
 const input=invitationRequest.parse(raw);
 const outcome=await withSyntheticIntake(db,async tx=>{
  const r=await tx.execute<{envelope:Envelope|null}>(sql`select public.connect_invitation_pending(${receiptHash(input.receiptToken)}) as envelope`);
  const sealed=r.rows[0]?.envelope;if(!sealed)return "unavailable";
  if("limited" in sealed)return "limited";
  if(!sealed.binding.endsWith(`:${receiptHash(input.receiptToken)}`))return "unavailable";
  const {email}=z.object({email:z.string().regex(/^[^@\s]+@example\.test$/i)}).parse(openIntake(sealed,sealed.binding));
  return enqueueInvitation(tx,receiptHash(input.receiptToken),email,true);
 });
 // Never disclose account/response existence or delivery success.
 if(outcome==="limited")return {limited:true} as const;
 return {acknowledged:true} as const;
}
export async function prepareInvitation(db:Database,raw:unknown) {
 const {token}=invitationPrepare.parse(raw),flow=randomSecret();
 const ok=await withSyntheticIntake(db,async tx=>{
  const r=await tx.execute<{ok:boolean}>(sql`select public.connect_invitation_prepare(${receiptHash(token)},${receiptHash(flow)}) as ok`);return r.rows[0]?.ok;
 });
 if(!ok)throw unavailable();return flow;
}
export type InvitationFlow={recipientHash:string;recipientBinding:string;sourcePath:string;automatic?:boolean;organizer?:string};
export async function readInvitationFlow(db:Database,flow:string):Promise<InvitationFlow|null> {
 if(!secret.safeParse(flow).success)return null;
 return withSyntheticIntake(db,async tx=>{
  const r=await tx.execute<{flow:InvitationFlow|null}>(sql`select public.connect_invitation_flow(${receiptHash(flow)}) as flow`);return r.rows[0]?.flow??null;
 });
}
async function consumeInvitationOnce(db:Database,flow:string,user:{id:string;email:string;emailVerified:boolean},raw:unknown) {
 requireSyntheticIntake();secret.parse(flow);const {action}=invitationClaim.parse(raw);
 return withUser(db,user.id,async tx=>{
  const [current]=await tx.select({email:users.email,verified:users.emailVerified}).from(users).where(eq(users.id,user.id)).for("share");
  if(!current?.verified)throw unavailable();
  await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);
  if(action==="confirm"){
   const completed=await tx.execute<{completed:boolean}>(sql`select public.connect_claim_completed(${receiptHash(flow)}) as completed`);
   if(completed.rows[0]?.completed)return {next:"/account/welcome"};
  }
  const f=await tx.execute<{flow:InvitationFlow|null}>(sql`select public.connect_invitation_flow(${receiptHash(flow)}) as flow`);
  const info=f.rows[0]?.flow;
  if(!info){
   if(action==="confirm"){
    const committed=await tx.execute<{completed:boolean}>(sql`select public.connect_claim_completed(${receiptHash(flow)}) as completed`);
    if(committed.rows[0]?.completed)return {next:"/account/welcome"};
   }
   throw unavailable();
  }
  const sourcePath=info.sourcePath;
  let preferredName:string|null=null;
  if(info.automatic&&action==="confirm"){
   const envelope=await tx.execute<{envelope:Envelope|null}>(sql`select public.connect_claim_envelope(${receiptHash(flow)}) as envelope`);
   const sealed=envelope.rows[0]?.envelope;if(!sealed)throw unavailable();
   const payload=z.object({email:z.string(),preferredName:z.string().trim().max(80).optional()}).parse(openIntake(sealed,sealed.binding));
   if(payload.email.toLowerCase()!==current.email.toLowerCase())throw unavailable();
   preferredName=payload.preferredName??null;
  }
  const result=info.automatic
   ?await tx.execute<{outcome:string}>(sql`select public.connect_invitation_consume_verified(${receiptHash(flow)},${user.id},${invitationRecipientHash(current.email,info.recipientBinding)},${current.email},${preferredName},${action==="decline"}) as outcome`)
   :await tx.execute<{outcome:string}>(sql`select public.connect_invitation_consume(${receiptHash(flow)},${user.id},${invitationRecipientHash(current.email,info.recipientBinding)},${action==="decline"}) as outcome`);
  const outcome=result.rows[0]?.outcome;if(outcome==="mismatch")throw new AccessError(409,message("Invitations.mismatch"),{reason:"mismatch"});
  if(outcome!=="claimed"&&outcome!=="declined")throw unavailable();
  return {next:`/account/welcome${sourcePath?`?from=${encodeURIComponent(sourcePath)}`:""}`};
 });
}
export async function dispatchInvitation(db:Database,send:InvitationSender,options:{timeoutMs?:number}={}) {
 const timeoutMs=z.number().int().min(1).max(20000).parse(options.timeoutMs??20000);
 const lease=randomUUID();
 const job=await withSyntheticIntake(db,async tx=>{
  const r=await tx.execute<{job:Reserved|null}>(sql`select public.connect_invitation_reserve(${lease}::uuid) as job`);return r.rows[0]?.job;
 });
 if(!job)return {status:"idle"} as const;
 const dispatch=(outcome:string,backoff=0)=>withSyntheticIntake(db,async tx=>{
  const r=await tx.execute<{ok:boolean}>(sql`select public.connect_invitation_dispatch(${job.id}::uuid,${lease}::uuid,${outcome},${backoff}) as ok`);return r.rows[0]?.ok;
 });
 try {
  const payload=z.object({email:z.string().regex(/^[^@\s]+@example\.test$/i),token:secret}).strict().parse(openIntake(job.envelope,`invitation:${job.receiptHash}:${job.tokenHash}`));
  if(job.tokenHash!==receiptHash(payload.token))throw new Error("INVALID_BINDING");
  if(!await dispatch("check"))return {status:"cancelled"} as const;
  // External I/O occurs after the reservation transaction commits. Generation key fences retries.
  const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([
   send({to:payload.email,token:payload.token,idempotencyKey:`connect-invitation:${job.id}:${job.generation}`,signal:controller.signal}),
   new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{reject(new Error("DELIVERY_TIMEOUT"));controller.abort();},timeoutMs);})
  ]);}finally{clearTimeout(timeout);}
  return {status:await dispatch("sent")?"sent":"cancelled"} as const;
 }catch{
  await dispatch("retry",backoffMs(job.attempt));return {status:"retry"} as const;
 }
}
export async function purgeInvitations(db:Database) {
 return withSyntheticIntake(db,async tx=>{const r=await tx.execute<{count:number}>(sql`select public.purge_connect_invitations() as count`);return {purged:r.rows[0]?.count??0};});
}
export const safeSourcePath=(value:unknown)=>typeof value==="string"&&/^\/c\/[a-f0-9]{32}$/.test(value)?value:"/resources/start";

// Retry only transaction conflicts. Every attempt reloads and locks the live verified user,
// recomputes recipient proof and reruns the entire transaction; never retry a partial write.
export async function consumeInvitation(db:Database,flow:string,user:{id:string;email:string;emailVerified:boolean},raw:unknown) {
 return retryConnectTransaction(()=>consumeInvitationOnce(db,flow,user,raw),true);
}

export async function invitationCompleted(db:Database,flow:string,userId:string){
 requireSyntheticIntake();if(!secret.safeParse(flow).success)return false;
 return withUser(db,userId,async tx=>{
  await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);
  const result=await tx.execute<{completed:boolean}>(sql`select public.connect_claim_completed(${receiptHash(flow)}) as completed`);
  return result.rows[0]?.completed===true;
 });
}
