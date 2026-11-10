import { randomUUID } from "node:crypto";
import { expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink,transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm,readIntakeManifest,submitIntake } from "../../src/server/connect-intake";
import { consumeInvitation,prepareInvitation,dispatchInvitation } from "../../src/server/connect-invitations";
import { listSubjectResponses,applySubjectRights } from "../../src/server/connect-subject-rights";
import { getContact } from "../../src/server/contacts";
for(const populated of [false,true])it(`v3 claim/rights under actual non-bypass migration owner; populated upgrade=${populated}`,async()=>{
 const f=await testDatabase({migrationOwner:true,...(populated?{beforeHc06bMigration:async admin=>{
  await admin.query("insert into users(id,name,email) values('legacy-b-owner','Legacy','legacy-b@example.test')");
  const tenant=randomUUID();await admin.query("insert into workspaces(tenant_id,name,created_by) values($1,'Legacy','legacy-b-owner')",[tenant]);
  await admin.query("insert into contacts(tenant_id,name) values($1,'Unproven legacy origin')",[tenant]);
 }}:{})});
 try{
  vi.stubEnv("NODE_ENV","test");vi.stubEnv("DATABASE_URL",f.appURL);vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("HARVEST_CONNECT_TEST_KEY","a".repeat(64));
  await f.db.insert(users).values([{id:"b-owner",name:"Owner",email:"owner-b@example.test",emailVerified:true},{id:"b-guest",name:"Guest",email:"guest-b@example.test",emailVerified:true}]);
  const tenant=(await createWorkspace(f.db,"b-owner","Organizer")).tenantId;
  const campaign=(await createCampaign(f.db,"b-owner",tenant,{name:"Campaign",type:"conference"},randomUUID())).id;
  const version=await publishIntakeForm(f.db,"b-owner",tenant,campaign,{name:"V3",notice:"Synthetic test",retentionDays:1,purposes:["account_communications","newsletter"],definition:{kind:"connect-intake-v3",syntheticOnly:true,preferredName:true,followUpChannel:"email"}});
  const link=await createConnectLink(f.db,"b-owner",tenant,campaign,{formVersionId:version.id});await transitionConnectLink(f.db,"b-owner",tenant,campaign,link.id,{action:"publish"});
  const manifest=(await readIntakeManifest(f.db,"qr",link.publicCode))!;
  await submitIntake(f.db,"qr",link.publicCode,{submissionId:randomUUID(),receiptToken:manifest.receiptToken,stamp:manifest.stamp,capability:manifest.capability,purposes:["account_communications","newsletter"],email:"guest-b@example.test",preferredName:"Preferred visitor"});
  let token="";await dispatchInvitation(f.db,async mail=>{token=mail.token;});const flow=await prepareInvitation(f.db,{token});
  await consumeInvitation(f.db,flow,{id:"b-guest",email:"guest-b@example.test",emailVerified:true},{action:"confirm"});
  expect(await consumeInvitation(f.db,flow,{id:"b-guest",email:"guest-b@example.test",emailVerified:true},{action:"confirm"})).toEqual({next:"/account/welcome"});
  const page=await listSubjectResponses(f.db,"b-guest");expect(page.items).toHaveLength(1);expect(page.items[0].organizer).toBe("Organizer");
  const contact=(await f.admin.query("select contact_id from campaign_responses where status='associated'")).rows[0].contact_id;
  const person=await getContact(f.db,"b-owner",tenant,contact);expect(person.sourceHistory?.[0].sourceLabel).toContain("Campaign");
  await applySubjectRights(f.db,"b-guest",{handle:page.items[0].handle,action:"withdraw",purpose:"newsletter"});
  expect((await listSubjectResponses(f.db,"b-guest")).items[0].purposes).toEqual([]);
  await applySubjectRights(f.db,"b-guest",{handle:page.items[0].handle,action:"erase"});
  expect((await listSubjectResponses(f.db,"b-guest")).items).toEqual([]);
  expect((await getContact(f.db,"b-owner",tenant,contact)).erasedAt).toBeNull();
  await f.admin.query("begin");
  try{
   await f.admin.query(`set local role ${f.migrationOwner}`);
   await f.admin.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id','b-guest',true)",[tenant]);
   await f.admin.query("insert into contact_consents(tenant_id,contact_id,purpose,notice_version,channel,status,source,evidence) values($1,$2,'newsletter','connect-immutable','email','granted','Connect','Forged origin')",[tenant,contact]);
   await f.admin.query("select set_config('app.tenant_id','',true)");
   await expect(f.admin.query("commit")).rejects.toMatchObject({code:"23514"});
  }finally{await f.admin.query("rollback");}
  if(populated)expect((await f.admin.query("select count(*)::int as n from contact_source_events s join contacts c on c.tenant_id=s.tenant_id and c.id=s.contact_id where c.name='Unproven legacy origin'")).rows[0].n).toBe(0);
 }finally{vi.unstubAllEnvs();await f.close();}
});
