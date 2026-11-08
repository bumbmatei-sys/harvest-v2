import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace,putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink,transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm,listIntakeForms,readIntakeManifest,submitIntake,applyIntakeRights,purgeIntake,withSyntheticIntake } from "../../src/server/connect-intake";
import { eraseConnectResponse,isConnectResponsePurposeActive } from "../../src/server/connect-responses";
import { issueIntakeCapability,receiptHash } from "../../src/server/connect-intake-crypto";
import { withTenant } from "../../src/server/tenancy";
let f:Awaited<ReturnType<typeof testDatabase>>,a:string,b:string,ca:string,cb:string;
const definition={kind:"connect-intake-v1",syntheticOnly:true,preferredName:true,followUpChannel:"email"};
const setup={name:"Synthetic preset",notice:"Test purposes and rights, not approved legal text",retentionDays:3,definition,purposes:["outreach_follow_up","newsletter"]};
async function source(tenant=a,campaign=ca,user="hc05-owner",overrides={}) {
 const version=await publishIntakeForm(f.db,user,tenant,campaign,{...setup,...overrides});
 const l=await createConnectLink(f.db,user,tenant,campaign,{label:"Synthetic source",formVersionId:version.id});
 await transitionConnectLink(f.db,user,tenant,campaign,l.id,{action:"publish"});
 const manifest=(await readIntakeManifest(f.db,"qr",l.publicCode))!;
 return {l,manifest,version};
}
function body(manifest:{stamp:string;capability:string},extra={}) {return {submissionId:randomUUID(),receiptToken:receiptHash(manifest.capability),stamp:manifest.stamp,capability:manifest.capability,purposes:["outreach_follow_up","newsletter"],preferredName:"Synthetic Guest",email:"guest@example.test",phone:"",website:"",...extra};}
async function pending(token:string){return (await f.admin.query(`select r.* from campaign_responses r join connect_intake_receipts x on x.tenant_id=r.tenant_id and x.response_id=r.id where x.receipt_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,[token])).rows[0];}
beforeAll(async()=>{
 f=await testDatabase();vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("HARVEST_CONNECT_TEST_KEY","c".repeat(64));vi.stubEnv("DATABASE_URL",f.appURL);
 await f.db.insert(users).values(["hc05-owner","hc05-member","hc05-other"].map(id=>({id,name:id,email:`${id}@example.test`})));
 a=(await createWorkspace(f.db,"hc05-owner","Intake A")).tenantId;b=(await createWorkspace(f.db,"hc05-other","Intake B")).tenantId;
 await putMember(f.db,"hc05-owner",a,"hc05-member@example.test","member");
 ca=(await createCampaign(f.db,"hc05-owner",a,{name:"Synthetic A",type:"conference"},"hc05-a")).id;
 cb=(await createCampaign(f.db,"hc05-other",b,{name:"Synthetic B",type:"conference"},"hc05-b")).id;
});
afterAll(async()=>{vi.unstubAllEnvs();await f?.close();});
it("creates immutable revisions through owner/admin services and denies members/foreign parents",async()=>{
 const {version}=await source();const first=(await listIntakeForms(f.db,"hc05-owner",a,ca)).find(v=>v.id===version.id)!;
 const revision=await publishIntakeForm(f.db,"hc05-owner",a,ca,{...setup,formId:first.formId,definition:{...definition,preferredName:false}});
 expect(revision.version).toBe(2);expect((await f.admin.query("select definition from form_versions where id=$1",[version.id])).rows[0].definition.preferredName).toBe(true);
 await expect(publishIntakeForm(f.db,"hc05-member",a,ca,setup)).rejects.toMatchObject({status:403});
 await expect(publishIntakeForm(f.db,"hc05-other",b,cb,{...setup,formId:first.formId})).rejects.toMatchObject({status:404});
 await expect(publishIntakeForm(f.db,"hc05-owner",a,cb,setup)).rejects.toMatchObject({status:404});
 await expect(withTenant(f.db,"hc05-owner",a,"connect:publish",tx=>tx.execute(sql`update form_versions set definition='{}' where id=${version.id}`))).rejects.toThrow();
});
it("resolves the same allowlisted immutable form for both code kinds, without writes or tenant leaks",async()=>{
 const {l,manifest}=await source();const before=await f.admin.query("select count(*) from campaign_responses");
 expect(await readIntakeManifest(f.db,"short",l.shortCode.toLowerCase())).toMatchObject({stamp:manifest.stamp,definition:manifest.definition,purposes:manifest.purposes});
 expect(Object.keys(manifest).sort()).toEqual(["capability","definition","notice","purposes","receiptToken","retentionDays","stamp"]);
 expect(JSON.stringify(manifest)).not.toContain(a);expect(JSON.stringify(manifest)).not.toContain(l.id);
 expect((await f.admin.query("select count(*) from campaign_responses")).rows).toEqual(before.rows);
 expect(await readIntakeManifest(f.db,"qr","a".repeat(32))).toBeNull();
 expect((await f.pool.query("select current_setting('app.tenant_id',true) as tenant,current_setting('app.connect_intake_mode',true) as mode")).rows[0]).toEqual({tenant:"",mode:""});
});
it.each([["outreach_follow_up"],["newsletter"],["outreach_follow_up","newsletter"]])("records exactly the selected purposes: %j",async(...purposes:string[])=>{
 const {l,manifest}=await source();const input=body(manifest,{purposes});
 const before=(await f.admin.query("select (select count(*) from contacts) as contacts,(select count(*) from outbox_events) as outbox,(select count(*) from jobs) as jobs")).rows;
 expect(await submitIntake(f.db,"qr",l.publicCode,input)).toMatchObject({pending:true,replayed:false});
 const r=await pending(input.receiptToken);expect(r.status).toBe("pending");expect(r.contact_id).toBeNull();expect(r.preferred_name).toBeNull();
 const evidence=(await f.admin.query("select purpose,channel,actor_kind from campaign_response_consents where response_id=$1 order by purpose",[r.id])).rows;
 expect(evidence.map(x=>x.purpose)).toEqual([...purposes].sort());expect(evidence.every(x=>x.actor_kind==="subject"&&x.channel==="email")).toBe(true);
 expect((await f.admin.query("select (select count(*) from contacts) as contacts,(select count(*) from outbox_events) as outbox,(select count(*) from jobs) as jobs")).rows).toEqual(before);
 const methods=(await f.admin.query("select * from campaign_response_contact_methods where response_id=$1",[r.id])).rows;expect(methods).toHaveLength(1);expect(methods[0].value).toMatch(/^sealed:/);
 const sealed=(await f.admin.query("select sealed_data from connect_intake_receipts where response_id=$1",[r.id])).rows[0].sealed_data;
 expect(JSON.stringify(sealed)).not.toMatch(/guest@example|Synthetic Guest/);expect(sealed.version).toBe(1);
});
it("serializes concurrent retries and refuses changed-body or stolen-submission replays",async()=>{
 const {l,manifest}=await source(),input=body(manifest);
 const outcomes=await Promise.all([submitIntake(f.db,"qr",l.publicCode,input),submitIntake(f.db,"qr",l.publicCode,input)]);
 expect(outcomes.filter(x=>!x.limited&&!x.replayed)).toHaveLength(1);expect(outcomes.filter(x=>!x.limited&&x.replayed)).toHaveLength(1);
 expect((await f.admin.query("select count(*)::int as n from campaign_responses where public_submission_id=$1",[input.submissionId])).rows[0].n).toBe(1);
 await expect(submitIntake(f.db,"qr",l.publicCode,{...input,email:"other@example.test"})).rejects.toMatchObject({status:409});
 await expect(submitIntake(f.db,"qr",l.publicCode,{...input,receiptToken:"d".repeat(64)})).rejects.toMatchObject({status:409});
});
it("denies empty/unoffered purposes, real contacts, honeypot and missing needed channels without writes",async()=>{
 const {l,manifest}=await source();const before=(await f.admin.query("select count(*) from campaign_responses")).rows;
 for(const extra of [{purposes:[]},{purposes:["account_communications"]},{email:"person@gmail.com"},{email:""},{phone:"+15555550100"},{website:"bot"},{preferredName:"x".repeat(81)}])await expect(submitIntake(f.db,"qr",l.publicCode,body(manifest,extra))).rejects.toThrow();
 expect((await f.admin.query("select count(*) from campaign_responses")).rows).toEqual(before);
 const limited=await source(a,ca,"hc05-owner",{purposes:["newsletter"],definition:{...definition,preferredName:false}});
 await expect(submitIntake(f.db,"qr",limited.l.publicCode,body(limited.manifest))).rejects.toMatchObject({status:400});
 await expect(submitIntake(f.db,"qr",limited.l.publicCode,body(limited.manifest,{purposes:["newsletter"],preferredName:"injected"}))).rejects.toMatchObject({status:400});
});
it("keeps one purpose active on withdrawal; token gives no identity/CRM authority; erase scrubs and prevents replay",async()=>{
 const {l,manifest}=await source(),input=body(manifest);await submitIntake(f.db,"qr",l.publicCode,input);const r=await pending(input.receiptToken);
 await applyIntakeRights(f.db,{receiptToken:input.receiptToken,action:"withdraw",purpose:"newsletter"});
 expect(await isConnectResponsePurposeActive(f.db,"hc05-owner",a,r.id,"newsletter")).toBe(false);
 expect(await isConnectResponsePurposeActive(f.db,"hc05-owner",a,r.id,"outreach_follow_up")).toBe(true);
 await applyIntakeRights(f.db,{receiptToken:input.receiptToken,action:"withdraw",purpose:"newsletter"});
 expect((await f.admin.query("select count(*)::int as n from campaign_response_consents where response_id=$1 and status='withdrawn'",[r.id])).rows[0].n).toBe(1);
 await applyIntakeRights(f.db,{receiptToken:input.receiptToken,action:"erase"});expect(await pending(input.receiptToken)).toBeUndefined();
 expect((await f.admin.query("select * from campaign_response_contact_methods where response_id=$1",[r.id])).rows).toEqual([]);
 expect((await f.admin.query("select * from campaign_response_consents where response_id=$1",[r.id])).rows).toEqual([]);
 expect((await f.admin.query("select * from audit_logs where target_id=$1",[r.id])).rows).toEqual([]);
 await expect(submitIntake(f.db,"qr",l.publicCode,input)).rejects.toMatchObject({status:404});
 expect(await applyIntakeRights(f.db,{receiptToken:input.receiptToken,action:"erase"})).toEqual({acknowledged:true});
 expect(await applyIntakeRights(f.db,{receiptToken:"b".repeat(64),action:"erase"})).toEqual({acknowledged:true});
});
it("owner erasure also removes receipts, and expiry purge uses its own bounded capability without an owner actor",async()=>{
 const {l,manifest}=await source(),input=body(manifest);await submitIntake(f.db,"qr",l.publicCode,input);const r=await pending(input.receiptToken);
 await eraseConnectResponse(f.db,"hc05-owner",a,r.id);expect(await pending(input.receiptToken)).toBeUndefined();
 const expired=body((await readIntakeManifest(f.db,"qr",l.publicCode))!);await submitIntake(f.db,"qr",l.publicCode,expired);const old=await pending(expired.receiptToken);
 await f.admin.query("update campaign_responses set expires_at=now()-interval '1 day' where id=$1",[old.id]);
 expect(await purgeIntake(f.db)).toEqual({purged:1});expect(await pending(expired.receiptToken)).toBeUndefined();
 expect(await purgeIntake(f.db)).toEqual({purged:0});
 await expect(submitIntake(f.db,"qr",l.publicCode,expired)).rejects.toMatchObject({status:404});
});
it("refuses stale notice/form, retired, paused, rotated and archived sources at submit",async()=>{
 for(const action of ["retire","disable","rotate","archive"]){
  const {l,manifest,version}=await source(),input=body(manifest);
  if(action==="retire")await withTenant(f.db,"hc05-owner",a,"connect:publish",tx=>tx.execute(sql`update form_versions set status='retired' where id=${version.id}`));
  else await transitionConnectLink(f.db,"hc05-owner",a,ca,l.id,{action,expectedCode:l.publicCode});
  await expect(submitIntake(f.db,"qr",l.publicCode,input)).rejects.toMatchObject({status:404});
 }
 const {l,manifest}=await source();await expect(submitIntake(f.db,"qr",l.publicCode,body({...manifest,stamp:"0".repeat(64)}))).rejects.toMatchObject({status:409});
});
it("FORCE RLS and zero app table grants hold despite forged context, and quotas persist",async()=>{
 for(const table of ["connect_intake_receipts","connect_intake_limits","connect_intake_events"]){
  expect((await f.admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[table])).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
  await expect(withTenant(f.db,"hc05-owner",a,"connect:privacy",tx=>tx.execute(sql.raw(`select * from ${table}`)))).rejects.toMatchObject({cause:{code:"42501"}});
 }
 await expect(f.pool.query("select * from connect_intake_source('qr',$1)",["a".repeat(32)])).rejects.toMatchObject({code:"42501"});
 const {l,manifest}=await source();const input=body(manifest);await submitIntake(f.db,"qr",l.publicCode,input);
 for(let n=0;n<11;n++)await submitIntake(f.db,"qr",l.publicCode,input);
 expect(await submitIntake(f.db,"qr",l.publicCode,input)).toEqual({limited:true});
 const result=await withSyntheticIntake(f.db,tx=>tx.execute(sql`select public.connect_intake_manifest('qr',${l.publicCode}) as manifest`));expect(result.rows[0].manifest).not.toBeNull();
});
it("fails closed outside local synthetic mode, including production even with the flag set",async()=>{
 const {l,manifest}=await source();vi.stubEnv("NODE_ENV","production");
 expect(await readIntakeManifest(f.db,"qr",l.publicCode)).toBeNull();await expect(submitIntake(f.db,"qr",l.publicCode,body(manifest))).rejects.toMatchObject({status:404});
 vi.stubEnv("NODE_ENV","test");
});

it("cannot resurrect erased data after replay suppression expires or an old presentation times out",async()=>{
 const {l,manifest}=await source(),input=body(manifest);await submitIntake(f.db,"qr",l.publicCode,input);
 await applyIntakeRights(f.db,{receiptToken:input.receiptToken,action:"erase"});
 await f.admin.query("update connect_intake_limits set expires_at=now()-interval '1 day' where key like 'revoked:%'");await purgeIntake(f.db);
 const time=Date.now();const clock=vi.spyOn(Date,"now").mockReturnValue(time+601000);
 try {await expect(submitIntake(f.db,"qr",l.publicCode,input)).rejects.toMatchObject({status:409});} finally {clock.mockRestore();}
 const stale=body({...manifest,capability:issueIntakeCapability("qr",l.publicCode,manifest.stamp,time-601000)});
 await expect(submitIntake(f.db,"qr",l.publicCode,stale)).rejects.toMatchObject({status:409});
 expect(await pending(input.receiptToken)).toBeUndefined();
});

it("serializes saved and changed-ID requests against successful erase/purge commits",async()=>{
 const {Pool}=await import("pg"),{drizzle}=await import("drizzle-orm/node-postgres"),schema=await import("../../src/db/schema");
 const pool=new Pool({connectionString:f.appURL,max:4}),db=drizzle(pool,{schema});
 try {
  for(const action of ["erase","purge"] as const){
   const {l,manifest}=await source(),input=body(manifest);await submitIntake(db,"qr",l.publicCode,input);
   const row=await pending(input.receiptToken);
   if(action==="purge")await f.admin.query("update campaign_responses set expires_at=now()-interval '1 day' where id=$1",[row.id]);
   let ready!:()=>void,release!:()=>void;const begun=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;});
   const removal=action==="erase"?withTenant(f.db,"hc05-owner",a,"connect:privacy",async tx=>{
    await tx.execute(sql`select public.erase_connect_response(${a}::uuid,${row.id}::uuid)`);ready();await gate;
   }):withSyntheticIntake(f.db,async tx=>{await tx.execute(sql`select public.purge_connect_intake()`);ready();await gate;});
   await begun;
   const saved=submitIntake(db,"qr",l.publicCode,input).then(()=>"unexpected",e=>(e as {status:number}).status);
   const changed=submitIntake(db,"qr",l.publicCode,{...input,submissionId:randomUUID()}).then(()=>"unexpected",e=>(e as {status:number}).status);
   try {await expect.poll(async()=>Number((await f.admin.query("select count(*) as n from pg_stat_activity where datname=current_database() and usename='harvest_app' and wait_event_type='Lock' and query like '%submit_connect_intake%' ")).rows[0].n)).toBeGreaterThanOrEqual(1);} finally {release();}
   await removal;expect(await saved).toBe(404);expect(await changed).toBe(404);expect(await pending(input.receiptToken)).toBeUndefined();
  }
 } finally {await pool.end();}
});
it("owner erasure racing a locked replay fails atomically for retry instead of deadlocking",async()=>{
 const {Pool}=await import("pg"),{drizzle}=await import("drizzle-orm/node-postgres"),schema=await import("../../src/db/schema");
 const pool=new Pool({connectionString:f.appURL,max:2,options:"-c statement_timeout=10000"}),db=drizzle(pool,{schema});
 const locker=new Pool({...f.admin.options,max:1});
 try {
  const {l,manifest}=await source(),input=body(manifest);await submitIntake(db,"qr",l.publicCode,input);const row=await pending(input.receiptToken);
  const owner=await locker.connect();
  try {
   await owner.query("begin");
   // The fixture acquires the existing definer's row lock before switching to the real app role.
   await owner.query("select id from campaign_responses where tenant_id=$1 and id=$2 for update",[a,row.id]);
   await owner.query("set local role harvest_app");
   await owner.query("select set_config('app.user_id','hc05-owner',true),set_config('app.tenant_id',$1,true)",[a]);
   const retry=submitIntake(db,"qr",l.publicCode,input);
   try {
    await expect.poll(async()=>Number((await f.admin.query("select count(*) as n from pg_stat_activity where datname=current_database() and usename='harvest_app' and wait_event_type='Lock' and query like '%submit_connect_intake%' ")).rows[0].n)).toBeGreaterThanOrEqual(1);
    await expect(owner.query("select public.erase_connect_response($1,$2)",[a,row.id])).rejects.toMatchObject({code:"40001"});
   } finally {await owner.query("rollback");}
   expect(await retry).toMatchObject({replayed:true});
  } finally {owner.release();}
  await eraseConnectResponse(f.db,"hc05-owner",a,row.id);expect(await pending(input.receiptToken)).toBeUndefined();
  await expect(submitIntake(db,"qr",l.publicCode,input)).rejects.toMatchObject({status:404});
 } finally {await pool.end();await locker.end();}
});

it("binds each private receipt to one presentation proof, rejecting renewal before and after erasure",async()=>{
 const {l,manifest}=await source(),input=body(manifest);await submitIntake(f.db,"qr",l.publicCode,input);
 const newer=(await readIntakeManifest(f.db,"qr",l.publicCode))!;
 await expect(submitIntake(f.db,"qr",l.publicCode,{...input,capability:newer.capability})).rejects.toMatchObject({status:409});
 await applyIntakeRights(f.db,{receiptToken:input.receiptToken,action:"erase"});
 await f.admin.query("update connect_intake_limits set expires_at=now()-interval '1 day' where key like 'revoked:%'");await purgeIntake(f.db);
 await expect(submitIntake(f.db,"qr",l.publicCode,{...input,capability:newer.capability})).rejects.toMatchObject({status:409});
 expect(await pending(input.receiptToken)).toBeUndefined();
});

it("runs the bounded operator purge CLI as harvest_app and exits without server-only imports or open pools",async()=>{
 const {execFile}=await import("node:child_process"),{promisify}=await import("node:util");
 const {l,manifest}=await source(),input=body(manifest);await submitIntake(f.db,"qr",l.publicCode,input);const row=await pending(input.receiptToken);
 await f.admin.query("update campaign_responses set expires_at=now()-interval '1 day' where id=$1",[row.id]);
 const result=await promisify(execFile)(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/purge-connect-intake.ts"],{
  env:{...process.env,DATABASE_URL:f.appURL,NODE_ENV:"test",HARVEST_CONNECT_INTAKE:"synthetic",HARVEST_CONNECT_TEST_KEY:"c".repeat(64)},timeout:10000});
 expect(JSON.parse(result.stdout)).toEqual({purged:1});expect(result.stderr).toBe("");expect(await pending(input.receiptToken)).toBeUndefined();
});
