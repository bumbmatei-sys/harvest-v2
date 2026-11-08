import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink,transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm,readIntakeManifest,submitIntake,applyIntakeRights } from "../../src/server/connect-intake";
import { dispatchInvitation,prepareInvitation,readInvitationFlow,consumeInvitation,requestInvitation,purgeInvitations } from "../../src/server/connect-invitations";
import { receiptHash } from "../../src/server/connect-intake-crypto";
import { eraseConnectResponse,withdrawConnectResponsePurpose } from "../../src/server/connect-responses";
let f:Awaited<ReturnType<typeof testDatabase>>,tenant:string,campaign:string;
const guest={id:"hc07-guest",email:"guest@example.test",emailVerified:true};
const other={id:"hc07-other",email:"other@example.test",emailVerified:true};
async function source(purposes=["account_communications"],kind="connect-intake-v2"){
 const version=await publishIntakeForm(f.db,"hc07-owner",tenant,campaign,{name:"Invitation test",notice:"Synthetic account invitation notice",retentionDays:1,
  purposes,definition:{kind,syntheticOnly:true,preferredName:false,followUpChannel:"email"}});
 const link=await createConnectLink(f.db,"hc07-owner",tenant,campaign,{formVersionId:version.id});await transitionConnectLink(f.db,"hc07-owner",tenant,campaign,link.id,{action:"publish"});
 const manifest=(await readIntakeManifest(f.db,"qr",link.publicCode))!;
 const input={submissionId:randomUUID(),receiptToken:manifest.receiptToken,stamp:manifest.stamp,capability:manifest.capability,purposes,email:guest.email};
 return {link,manifest,input};
}
async function row(token:string){return (await f.admin.query("select i.* from connect_invitations i join connect_intake_receipts x on x.tenant_id=i.tenant_id and x.response_id=i.response_id where x.receipt_hash=$1",[receiptHash(token)])).rows[0];}
async function sent(s:Awaited<ReturnType<typeof source>>){
 await submitIntake(f.db,"qr",s.link.publicCode,s.input);let token="";
 // Isolate this fixture's due job when earlier tests intentionally leave jobs queued.
 const r=await row(s.input.receiptToken);await f.admin.query("update connect_invitations set available_at=now()+interval '1 day' where status='queued' and id<>$1",[r.id]);
 expect(await dispatchInvitation(f.db,async mail=>{token=mail.token;expect(mail.to).toBe(guest.email);})).toEqual({status:"sent"});
 return {token,flow:await prepareInvitation(f.db,{token}),row:r};
}
beforeAll(async()=>{
 f=await testDatabase();vi.stubEnv("NODE_ENV","test");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("HARVEST_CONNECT_TEST_KEY","a".repeat(64));vi.stubEnv("DATABASE_URL",f.appURL);
 await f.db.insert(users).values([{id:"hc07-owner",name:"Owner",email:"owner@example.test",emailVerified:true},guest,other].map(u=>({...u,name:u.id})));
 tenant=(await createWorkspace(f.db,"hc07-owner","HC07 fixture")).tenantId;campaign=(await createCampaign(f.db,"hc07-owner",tenant,{name:"Synthetic campaign",type:"conference"},"hc07")).id;
});
afterAll(async()=>{vi.unstubAllEnvs();await f?.close();});
it("atomically creates only requested invitation intent; retries neither duplicate nor replace its generation",async()=>{
 const s=await source();await submitIntake(f.db,"qr",s.link.publicCode,s.input);const first=await row(s.input.receiptToken);
 expect(first.status).toBe("queued");expect(first.generation).toBe(1);expect(JSON.stringify(first.envelope)).not.toContain(guest.email);
 await submitIntake(f.db,"qr",s.link.publicCode,s.input);expect((await row(s.input.receiptToken)).token_hash).toBe(first.token_hash);
 const evidence=(await f.admin.query("select purpose from campaign_response_consents where response_id=$1",[first.response_id])).rows;expect(evidence).toEqual([{purpose:"account_communications"}]);
 const legacy=await source(["newsletter"],"connect-intake-v1");await submitIntake(f.db,"qr",legacy.link.publicCode,legacy.input);expect(await row(legacy.input.receiptToken)).toBeUndefined();
 await expect(submitIntake(f.db,"qr",legacy.link.publicCode,{...legacy.input,purposes:["account_communications"]})).rejects.toMatchObject({status:400});
});
it("delivers via a fenced reservation outside the transaction, then claims only for the verified matching personal account",async()=>{
 const s=await source(),{flow,row:r}=await sent(s);
 expect(await readInvitationFlow(f.db,flow)).toEqual({recipientBinding:expect.stringMatching(/^[a-f0-9]{64}$/),recipientHash:expect.stringMatching(/^[a-f0-9]{64}$/),sourcePath:`/c/${s.link.publicCode}`});
 await expect(consumeInvitation(f.db,flow,other,{action:"confirm"})).rejects.toMatchObject({status:409});
 const before=(await f.admin.query("select (select count(*) from contacts) as contacts,(select count(*) from workspace_members) as members")).rows;
 expect(await consumeInvitation(f.db,flow,guest,{action:"confirm"})).toEqual({next:`/account/welcome?from=${encodeURIComponent(`/c/${s.link.publicCode}`)}`});
 expect((await f.admin.query("select user_id from response_account_claims where response_id=$1",[r.response_id])).rows).toEqual([{user_id:guest.id}]);
 expect((await f.admin.query("select status,contact_id from campaign_responses where id=$1",[r.response_id])).rows).toEqual([{status:"pending",contact_id:null}]);
 expect((await f.admin.query("select (select count(*) from contacts) as contacts,(select count(*) from workspace_members) as members")).rows).toEqual(before);
 await expect(consumeInvitation(f.db,flow,guest,{action:"confirm"})).rejects.toMatchObject({status:409});
});
it("lets a verified user continue without linking and leaves invitation unconsumed",async()=>{
 const s=await source(),{flow,token}=await sent(s);expect((await consumeInvitation(f.db,flow,other,{action:"decline"})).next).toContain("/account/welcome");
 expect((await row(s.input.receiptToken)).consumed_at).toBeNull();expect(await prepareInvitation(f.db,{token})).toMatch(/^[a-f0-9]{64}$/);
});
it("refuses unverified users even if the service input claims verification",async()=>{
 const s=await source(),{flow}=await sent(s);await f.admin.query("update users set email_verified=false where id=$1",[guest.id]);
 try{await expect(consumeInvitation(f.db,flow,guest,{action:"confirm"})).rejects.toMatchObject({status:409});}finally{await f.admin.query("update users set email_verified=true where id=$1",[guest.id]);}
});
it("resend is bounded, changes generation and invalidates previous links and continuations",async()=>{
 const s=await source(),{flow,token}=await sent(s);expect(await requestInvitation(f.db,{receiptToken:s.input.receiptToken})).toEqual({limited:true});
 await f.admin.query("update connect_invitations set issued_at=ARRAY[now()-interval '61 seconds'] where response_id=$1",[(await row(s.input.receiptToken)).response_id]);
 expect(await requestInvitation(f.db,{receiptToken:s.input.receiptToken})).toEqual({acknowledged:true});
 expect((await row(s.input.receiptToken)).generation).toBe(2);expect(await readInvitationFlow(f.db,flow)).toBeNull();
 await expect(prepareInvitation(f.db,{token})).rejects.toMatchObject({status:409});
});
it.each(["guest-withdraw","owner-withdraw","guest-erase","owner-erase"])("cancels delivery, token, flow and verified grant on %s",async action=>{
 const s=await source(["account_communications","newsletter"]),{flow,token,row:r}=await sent(s);
 if(action==="owner-erase")await consumeInvitation(f.db,flow,guest,{action:"confirm"});
 if(action==="guest-withdraw")await applyIntakeRights(f.db,{receiptToken:s.input.receiptToken,action:"withdraw",purpose:"account_communications"});
 if(action==="owner-withdraw")await withdrawConnectResponsePurpose(f.db,"hc07-owner",tenant,r.response_id,"account_communications");
 if(action==="guest-erase")await applyIntakeRights(f.db,{receiptToken:s.input.receiptToken,action:"erase"});
 if(action==="owner-erase")await eraseConnectResponse(f.db,"hc07-owner",tenant,r.response_id);
 expect(await row(s.input.receiptToken)).toBeUndefined();expect(await readInvitationFlow(f.db,flow)).toBeNull();
 expect((await f.admin.query("select * from response_account_claims where response_id=$1",[r.response_id])).rows).toEqual([]);
 await expect(prepareInvitation(f.db,{token})).rejects.toMatchObject({status:409});
});
it("withdrawing another purpose leaves the invitation valid",async()=>{
 const s=await source(["account_communications","newsletter"]),{flow}=await sent(s);
 await applyIntakeRights(f.db,{receiptToken:s.input.receiptToken,action:"withdraw",purpose:"newsletter"});expect(await readInvitationFlow(f.db,flow)).not.toBeNull();
});
it("expires proofs and purges envelopes/flows; source rotation also refuses an already prepared flow",async()=>{
 const s=await source(),{flow,token,row:r}=await sent(s);await f.admin.query("update connect_invitations set expires_at=now()-interval '1 second' where id=$1",[r.id]);
 await expect(prepareInvitation(f.db,{token})).rejects.toMatchObject({status:409});expect(await readInvitationFlow(f.db,flow)).toBeNull();await purgeInvitations(f.db);
 const rotated=await source(),ready=await sent(rotated);await transitionConnectLink(f.db,"hc07-owner",tenant,campaign,rotated.link.id,{action:"rotate",expectedCode:rotated.link.publicCode});
 expect(await readInvitationFlow(f.db,ready.flow)).toBeNull();
});
it("keeps restricted tables unreadable even with forged tenant context, and unknown credentials reveal no data",async()=>{
 for(const table of ["connect_invitations","connect_invitation_flows","response_account_claims"]){
  expect((await f.admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[table])).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
  await expect(f.pool.query(`select * from ${table}`)).rejects.toMatchObject({code:"42501"});
 }
 expect(await requestInvitation(f.db,{receiptToken:"b".repeat(64)})).toEqual({acknowledged:true});
 await expect(prepareInvitation(f.db,{token:"b".repeat(64)})).rejects.toMatchObject({status:409});
 expect([null,""]).toContain((await f.pool.query("select current_setting('app.tenant_id',true) as tenant")).rows[0].tenant);
});

it("rolls back the pending response and evidence if invitation persistence fails",async()=>{
 const s=await source();
 await f.admin.query("create function hc07_reject_invitation() returns trigger language plpgsql as $$ begin raise exception 'fixture refusal'; end $$");
 await f.admin.query("create trigger hc07_reject before insert on connect_invitations for each row execute function hc07_reject_invitation()");
 try{await expect(submitIntake(f.db,"qr",s.link.publicCode,s.input)).rejects.toThrow();}
 finally{await f.admin.query("drop trigger hc07_reject on connect_invitations");await f.admin.query("drop function hc07_reject_invitation()");}
 expect((await f.admin.query("select * from campaign_responses where public_submission_id=$1",[s.input.submissionId])).rows).toEqual([]);
 expect(await row(s.input.receiptToken)).toBeUndefined();
});
it("keeps ambiguous provider retries on one generation/key and blocks superseding an unsettled send",async()=>{
 const s=await source();await submitIntake(f.db,"qr",s.link.publicCode,s.input);const first=await row(s.input.receiptToken);
 await f.admin.query("update connect_invitations set available_at=now()+interval '1 day' where status='queued' and id<>$1",[first.id]);
 const keys:string[]=[],delivered=new Set<string>();
 expect(await dispatchInvitation(f.db,async mail=>{keys.push(mail.idempotencyKey);delivered.add(mail.idempotencyKey);throw new Error("Ambiguous accepted send");})).toEqual({status:"retry"});
 await f.admin.query("update connect_invitations set issued_at=ARRAY[now()-interval '61 seconds'],available_at=now() where id=$1",[first.id]);
 expect(await requestInvitation(f.db,{receiptToken:s.input.receiptToken})).toEqual({limited:true});
 expect(await dispatchInvitation(f.db,async mail=>{keys.push(mail.idempotencyKey);delivered.add(mail.idempotencyKey);})).toEqual({status:"sent"});
 expect(keys).toHaveLength(2);expect(new Set(keys).size).toBe(1);expect(delivered.size).toBe(1);
 expect((await row(s.input.receiptToken)).generation).toBe(1);
});
it("aborts a slow send before the lease expires and retains its generation for retry",async()=>{
 const s=await source();await submitIntake(f.db,"qr",s.link.publicCode,s.input);const first=await row(s.input.receiptToken);
 await f.admin.query("update connect_invitations set available_at=now()+interval '1 day' where status='queued' and id<>$1",[first.id]);
 let aborted=false;
 expect(await dispatchInvitation(f.db,async mail=>new Promise<void>((_,reject)=>{mail.signal?.addEventListener("abort",()=>{aborted=true;reject(new Error("Aborted"));},{once:true});}),{timeoutMs:20})).toEqual({status:"retry"});
 expect(aborted).toBe(true);expect((await row(s.input.receiptToken)).generation).toBe(1);
});
it("serializes simultaneous account claims with separate physical connections",async()=>{
 const {Pool}=await import("pg"),{drizzle}=await import("drizzle-orm/node-postgres"),schema=await import("../../src/db/schema");
 const pool=new Pool({connectionString:f.appURL,max:3}),db=drizzle(pool,{schema});
 try{
  const s=await source(),{token,flow,row:r}=await sent(s),another=await prepareInvitation(f.db,{token});
  const results=await Promise.all([flow,another].map(proof=>consumeInvitation(db,proof,guest,{action:"confirm"}).then(()=>"claimed",e=>(e as {status:number}).status)));
  expect(results.sort()).toEqual([409,"claimed"].sort());
  expect((await f.admin.query("select * from response_account_claims where response_id=$1",[r.response_id])).rows).toHaveLength(1);
 }finally{await pool.end();}
});
it("purge waits for an in-flight resend and rechecks the new generation instead of clearing it",async()=>{
 const {Pool}=await import("pg"),{drizzle}=await import("drizzle-orm/node-postgres"),schema=await import("../../src/db/schema");
 const {withSyntheticIntake}=await import("../../src/server/connect-intake-context"),{enqueueInvitation}=await import("../../src/server/connect-invitations");
 const pool=new Pool({connectionString:f.appURL,max:2}),db=drizzle(pool,{schema});
 try{
  const s=await source();await submitIntake(f.db,"qr",s.link.publicCode,s.input);const initial=await row(s.input.receiptToken);
  await f.admin.query("update connect_invitations set expires_at=now()-interval '1 second',issued_at=ARRAY[now()-interval '25 hours'] where id=$1",[initial.id]);
  let ready!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;});
  const resend=withSyntheticIntake(db,async tx=>{expect(await enqueueInvitation(tx,receiptHash(s.input.receiptToken),guest.email,true)).toBe("queued");ready();await gate;});
  await started;const purge=purgeInvitations(db);
  try{await expect.poll(async()=>Number((await f.admin.query("select count(*) as n from pg_stat_activity where usename='harvest_app' and datname=current_database() and wait_event_type='Lock' and query like '%purge_connect_invitations%' ")).rows[0].n)).toBeGreaterThanOrEqual(1);}finally{release();}
  await resend;await purge;const current=await row(s.input.receiptToken);expect(current.generation).toBe(2);expect(current.status).toBe("queued");expect(current.envelope).not.toBeNull();
 }finally{await pool.end();}
});

it("rejects a QR that expires while its claim waits on a receipt lock",async()=>{
 const {Pool}=await import("pg"),{drizzle}=await import("drizzle-orm/node-postgres"),schema=await import("../../src/db/schema");
 const {withSyntheticIntake}=await import("../../src/server/connect-intake-context");const {sql}=await import("drizzle-orm");
 const pool=new Pool({connectionString:f.appURL,max:2}),db=drizzle(pool,{schema});
 try{
  const s=await source(),{flow}=await sent(s);
  let ready!:()=>void,release!:()=>void;const begun=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;});
  const lock=withSyntheticIntake(db,async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'connect-intake-receipt:'+receiptHash(s.input.receiptToken)},0))`);ready();await gate;});
  await begun;const claim=consumeInvitation(db,flow,guest,{action:"confirm"}).then(()=>"unexpected",e=>(e as {status:number}).status);
  try{
   await expect.poll(async()=>Number((await f.admin.query("select count(*) as n from pg_stat_activity where usename='harvest_app' and datname=current_database() and wait_event_type='Lock' and query like '%connect_invitation_flow%' ")).rows[0].n)).toBeGreaterThanOrEqual(1);
   // Expire only the source while the older transaction waits; its response/token remain valid.
   await f.admin.query("update campaign_response_links set expires_at=clock_timestamp() where id=$1",[s.link.id]);
  }finally{release();}
  await lock;expect(await claim).toBe(409);
 }finally{await pool.end();}
});

it("cannot renew an old-source receipt after issuance metadata is cleaned and the QR rotates",async()=>{
 const s=await source();await submitIntake(f.db,"qr",s.link.publicCode,s.input);const original=await row(s.input.receiptToken);
 await f.admin.query("update connect_invitations set expires_at=now()-interval '1 hour',issued_at=ARRAY[now()-interval '25 hours'] where id=$1",[original.id]);await purgeInvitations(f.db);expect(await row(s.input.receiptToken)).toBeUndefined();
 await transitionConnectLink(f.db,"hc07-owner",tenant,campaign,s.link.id,{action:"rotate",expectedCode:s.link.publicCode});
 expect(await requestInvitation(f.db,{receiptToken:s.input.receiptToken})).toEqual({acknowledged:true});expect(await row(s.input.receiptToken)).toBeUndefined();
});
