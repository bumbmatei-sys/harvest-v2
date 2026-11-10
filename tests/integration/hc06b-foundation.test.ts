import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm, readIntakeManifest, submitIntake, applyIntakeRights } from "../../src/server/connect-intake";
import { dispatchInvitation, prepareInvitation, consumeInvitation } from "../../src/server/connect-invitations";
import { eraseConnectResponse } from "../../src/server/connect-responses";
import { mergeContacts } from "../../src/server/crm-merge";
import { recordConsent, eraseContact, getContact, createContact } from "../../src/server/contacts";
import { receiptHash } from "../../src/server/connect-intake-crypto";
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, response: string, token: string;
beforeAll(async () => {
  f = await testDatabase();
  vi.stubEnv("DATABASE_URL", f.appURL);
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
  await f.db.insert(users).values({ id: "hc06b-owner", name: "Owner", email: "hc06b@example.test", emailVerified: true });
  tenant = (await createWorkspace(f.db, "hc06b-owner", "Foundation")).tenantId;
  const campaign = (await createCampaign(f.db, "hc06b-owner", tenant, { name: "Synthetic", type: "conference" }, "hc06b")).id;
  const version = await publishIntakeForm(f.db, "hc06b-owner", tenant, campaign, { name: "Legacy", notice: "Synthetic only", retentionDays: 1,
    purposes: ["newsletter"], definition: { kind: "connect-intake-v2", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
  const link = await createConnectLink(f.db, "hc06b-owner", tenant, campaign, { formVersionId: version.id });
  await transitionConnectLink(f.db, "hc06b-owner", tenant, campaign, link.id, { action: "publish" });
  const manifest = (await readIntakeManifest(f.db, "qr", link.publicCode))!;
  token = manifest.receiptToken;
  await submitIntake(f.db, "qr", link.publicCode, { submissionId: randomUUID(), receiptToken: token, stamp: manifest.stamp, capability: manifest.capability,
    purposes: ["newsletter"], email: "hc06b@example.test" });
  response = (await f.admin.query("select response_id from connect_intake_receipts where receipt_hash=$1", [receiptHash(token)])).rows[0].response_id;
});
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });
it("forces RLS and grants no application reads or writes on durable capabilities", async () => {
  for (const table of ["connect_response_subjects", "connect_consent_origins", "connect_claim_completions"]) {
    const row = (await f.admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [table])).rows[0];
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect((await f.admin.query("select has_table_privilege('harvest_app',$1,$2) as allowed", [table, privilege])).rows[0].allowed).toBe(false);
    }
    await expect(f.pool.query(`select * from ${table}`)).rejects.toMatchObject({ code: "42501" });
  }
});
it("rejects bindings to an unassociated legacy response even with valid parent keys", async () => {
  await expect(f.admin.query("insert into connect_response_subjects(tenant_id,response_id,user_id) values($1,$2,$3)", [tenant, response, "hc06b-owner"]))
    .rejects.toMatchObject({ code: "23514" });
});
it("rejects invented continuation completion and cross-tenant provenance", async () => {
  await expect(f.admin.query("insert into connect_claim_completions(flow_hash,tenant_id,response_id,user_id,expires_at) values($1,$2,$3,$4,now()+interval '1 hour')",
    ["b".repeat(64), tenant, response, "hc06b-owner"])).rejects.toMatchObject({ code: "23514" });
  await expect(f.admin.query("insert into connect_consent_origins(tenant_id,consent_id,response_id,response_consent_id,form_version_id,notice_version_id) values($1,$2,$3,$4,$5,$6)",
    [randomUUID(), randomUUID(), response, randomUUID(), randomUUID(), randomUUID()])).rejects.toMatchObject({ code: "23514" });
});
it("preserves existing receipt erasure and leaves no durable capabilities", async () => {
  await applyIntakeRights(f.db, { receiptToken: token, action: "erase" });
  expect((await f.admin.query("select status from campaign_responses where id=$1", [response])).rows).toEqual([]);
  for (const table of ["connect_response_subjects", "connect_consent_origins", "connect_claim_completions"]) {
    expect((await f.admin.query(`select count(*)::int as count from ${table}`)).rows[0].count).toBe(0);
  }
});

it("rejects forged canonical Connect consent from app SQL and requires private origin at commit", async () => {
  const person = await createContact(f.db, "hc06b-owner", tenant, { name: "Independent CRM person" });
  const insert = "insert into contact_consents(tenant_id,contact_id,channel,status,purpose,notice_version,source,evidence) values($1,$2,'email','granted','newsletter','connect-immutable','Connect','Explicit choice')";
  await f.pool.query("begin");
  try {
    await f.pool.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id','hc06b-owner',true)", [tenant]);
    await expect(f.pool.query(insert, [tenant, person.id])).rejects.toMatchObject({ code: "42501" });
  } finally { await f.pool.query("rollback"); }
  await expect(f.admin.query(insert, [tenant, person.id])).rejects.toMatchObject({ code: "23514" });
  expect((await f.admin.query("select count(*)::int as count from contact_consents where contact_id=$1", [person.id])).rows[0].count).toBe(0);
});
it("keeps the association primitive private, including to a forged synthetic app context", async () => {
  expect((await f.admin.query("select has_function_privilege('harvest_app','public.connect_associate_verified(uuid,uuid,text,text,text)','EXECUTE') as allowed")).rows[0].allowed).toBe(false);
  await expect(f.pool.query("select public.connect_associate_verified($1,$2,null,null,null)", [tenant, response])).rejects.toMatchObject({ code: "42501" });
});

// This fixture stages the future v3 contract administratively. Public form validation still
// rejects v3, and no public association path is enabled by these tests.
async function verifiedFixture(purposes: string[]) {
  const campaign = (await createCampaign(f.db, "hc06b-owner", tenant, { name: "Verified fixture", type: "conference" }, randomUUID())).id;
  const version = await publishIntakeForm(f.db, "hc06b-owner", tenant, campaign, { name: "Future v3 fixture", notice: "Synthetic future automatic CRM association", retentionDays: 1,
    purposes, definition: { kind: "connect-intake-v2", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
  const link = await createConnectLink(f.db, "hc06b-owner", tenant, campaign, { formVersionId: version.id });
  await transitionConnectLink(f.db, "hc06b-owner", tenant, campaign, link.id, { action: "publish" });
  const manifest = (await readIntakeManifest(f.db, "qr", link.publicCode))!;
  await submitIntake(f.db, "qr", link.publicCode, { submissionId: randomUUID(), receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability,
    purposes, email: "hc06b@example.test" });
  let invitationToken = "";
  await dispatchInvitation(f.db, async mail => { invitationToken = mail.token; });
  const flow = await prepareInvitation(f.db, { token: invitationToken });
  await consumeInvitation(f.db, flow, { id: "hc06b-owner", email: "hc06b@example.test", emailVerified: true }, { action: "confirm" });
  const invitation = (await f.admin.query("select i.* from connect_invitations i join connect_intake_receipts x on x.tenant_id=i.tenant_id and x.response_id=i.response_id where x.receipt_hash=$1", [receiptHash(manifest.receiptToken)])).rows[0];
  await f.admin.query("begin");
  try {
    await f.admin.query("alter table form_versions disable trigger user");
    await f.admin.query("update form_versions set definition=jsonb_set(definition,'{kind}', '\"connect-intake-v3\"'::jsonb) where tenant_id=$1 and id=$2", [tenant, version.id]);
    await f.admin.query("alter table form_versions enable trigger user");
    await f.admin.query("commit");
  } catch (error) { await f.admin.query("rollback"); throw error; }
  return { invitation, receiptToken: manifest.receiptToken };
}
async function associate(invitation: { response_id: string; recipient_hash: string }, recipient = invitation.recipient_hash) {
  await f.admin.query("begin");
  try {
    await f.admin.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id','hc06b-owner',true),set_config('app.connect_intake_mode','synthetic',true)", [tenant]);
    const result = await f.admin.query("select public.connect_associate_verified($1,$2,$3,'hc06b@example.test',null) as id", [tenant, invitation.response_id, recipient]);
    await f.admin.query("select set_config('app.tenant_id','',true)");
    await f.admin.query("commit");
    return result.rows[0].id as string;
  } catch (error) { await f.admin.query("rollback"); throw error; }
}
it("associates account-only claims without adding messaging consent, and rejects replay", async () => {
  const { invitation } = await verifiedFixture(["account_communications"]);
  const id = await associate(invitation);
  expect((await f.admin.query("select status,contact_id from campaign_responses where id=$1", [invitation.response_id])).rows).toEqual([{ status: "associated", contact_id: id }]);
  expect((await f.admin.query("select count(*)::int as count from contact_consents where contact_id=$1", [id])).rows[0].count).toBe(0);
  expect((await f.admin.query("select kind,outcome,entry_route from contact_source_events where contact_id=$1", [id])).rows).toEqual([{ kind: "connect", outcome: "created", entry_route: "qr" }]);
  await expect(associate(invitation)).rejects.toBeDefined();
});
it("reuses the existing verified email and preserves original grant time and immutable origin", async () => {
  const { invitation } = await verifiedFixture(["account_communications", "newsletter"]);
  await expect(associate(invitation, "c".repeat(64))).rejects.toMatchObject({ code: "42501" });
  const id = await associate(invitation);
  expect((await f.admin.query("select count(*)::int as count from contact_identifiers where tenant_id=$1 and normalized_value='hc06b@example.test'", [tenant])).rows[0].count).toBe(1);
  expect((await f.admin.query("select c.purpose,c.recorded_by,c.notice_version,c.occurred_at=r.occurred_at as original_time from connect_consent_origins o join contact_consents c on c.tenant_id=o.tenant_id and c.id=o.consent_id join campaign_response_consents r on r.tenant_id=o.tenant_id and r.id=o.response_consent_id where o.response_id=$1", [invitation.response_id])).rows)
    .toEqual([{ purpose: "newsletter", recorded_by: null, notice_version: "connect-immutable", original_time: true }]);
  expect((await f.admin.query("select outcome from contact_source_events where contact_id=$1 and response_id=$2", [id, invitation.response_id])).rows).toEqual([{ outcome: "updated" }]);
});

it("scrubs a response source and projected grants without deleting the CRM person", async () => {
  const { invitation } = await verifiedFixture(["account_communications", "newsletter"]);
  const id = await associate(invitation);
  const origins = (await f.admin.query("select consent_id from connect_consent_origins where response_id=$1", [invitation.response_id])).rows;
  await eraseConnectResponse(f.db, "hc06b-owner", tenant, invitation.response_id);
  expect((await f.admin.query("select count(*)::int as count from contact_source_events where response_id=$1", [invitation.response_id])).rows[0].count).toBe(0);
  expect((await f.admin.query("select redacted_at,source,evidence,channel from contact_consents where id=$1", [origins[0].consent_id])).rows[0]).toEqual({ redacted_at: expect.any(Date), source: null, evidence: null, channel: null });
  expect((await getContact(f.db, "hc06b-owner", tenant, id)).erasedAt).toBeNull();
});
it("moves associated responses and durable rights before erasing a merged source contact", async () => {
  const { invitation } = await verifiedFixture(["account_communications"]);
  const id = await associate(invitation);
  const source = await getContact(f.db, "hc06b-owner", tenant, id);
  const kept = await createContact(f.db, "hc06b-owner", tenant, { name: "Kept independent contact" });
  await mergeContacts(f.db, "hc06b-owner", tenant, kept.id, { sourceId: id, sourceVersion: source.version, targetVersion: kept.version });
  expect((await f.admin.query("select status,contact_id from campaign_responses where id=$1", [invitation.response_id])).rows).toEqual([{ status: "associated", contact_id: kept.id }]);
  expect((await f.admin.query("select count(*)::int as count from connect_response_subjects where response_id=$1", [invitation.response_id])).rows[0].count).toBe(1);
});

// End-to-end service fixtures use the actual immutable v3 publication contract.
async function automaticFlow(purposes=["account_communications"],name="Visitor",email="b-visitor@example.test"){
  const campaign=(await createCampaign(f.db,"hc06b-owner",tenant,{name:"Automatic CRM",type:"conference"},randomUUID())).id;
  const version=await publishIntakeForm(f.db,"hc06b-owner",tenant,campaign,{name:"V3",notice:"Synthetic separate choices",retentionDays:1,purposes,
    definition:{kind:"connect-intake-v3",syntheticOnly:true,preferredName:true,followUpChannel:"email"}});
  const link=await createConnectLink(f.db,"hc06b-owner",tenant,campaign,{formVersionId:version.id});
  await transitionConnectLink(f.db,"hc06b-owner",tenant,campaign,link.id,{action:"publish"});
  const manifest=(await readIntakeManifest(f.db,"qr",link.publicCode))!;
  expect(manifest.notice).toContain("automatically added");
  await submitIntake(f.db,"qr",link.publicCode,{submissionId:randomUUID(),receiptToken:manifest.receiptToken,stamp:manifest.stamp,capability:manifest.capability,purposes,email,preferredName:name});
  let token="";await dispatchInvitation(f.db,async mail=>{token=mail.token;});
  const flow=await prepareInvitation(f.db,{token});
  const invitation=(await f.admin.query("select i.* from connect_invitations i join connect_intake_receipts r on r.tenant_id=i.tenant_id and r.response_id=i.response_id where r.receipt_hash=$1",[receiptHash(manifest.receiptToken)])).rows[0];
  return {flow,link,manifest,invitation,campaign};
}
const visitor={id:"b-visitor",email:"b-visitor@example.test",emailVerified:true};
it("atomically associates a v3 claim for a verified guest without organizer membership; recovers lost success",async()=>{
 await f.db.insert(users).values({...visitor,name:"Account name"});
 const s=await automaticFlow();
 expect((await f.admin.query("select max(extract(epoch from(expires_at-clock_timestamp())))::float8 as seconds from connect_invitation_flows where invitation_id=$1",[s.invitation.id])).rows[0].seconds).toBeLessThanOrEqual(600);
 expect((await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"})).next).toContain("/account/welcome");
 const r=(await f.admin.query("select * from campaign_responses where id=$1",[s.invitation.response_id])).rows[0];
 expect(r.status).toBe("associated");expect((await f.admin.query("select name from contacts where id=$1",[r.contact_id])).rows[0].name).toBe("Visitor");
 expect((await f.admin.query("select count(*)::int as n from workspace_members where tenant_id=$1 and user_id=$2",[tenant,visitor.id])).rows[0].n).toBe(0);
 expect((await f.admin.query("select count(*)::int as n from contact_consents where contact_id=$1",[r.contact_id])).rows[0].n).toBe(0);
 expect(await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"})).toEqual({next:"/account/welcome"});
 expect((await f.admin.query("select count(*)::int as n from contact_source_events where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(1);
 await expect(consumeInvitation(f.db,s.flow,{...visitor,id:"hc06b-owner"},{action:"confirm"})).rejects.toMatchObject({status:409});
});
it("retains durable subject rights after invitation claims expire and propagates only selected withdrawal",async()=>{
 const {listSubjectResponses,applySubjectRights}=await import("../../src/server/connect-subject-rights");
 const {purgeInvitations}=await import("../../src/server/connect-invitations");
 const s=await automaticFlow(["account_communications","newsletter","outreach_follow_up"],"Do not overwrite");
 await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 await f.admin.query("update response_account_claims set expires_at=verified_at+interval '1 millisecond' where response_id=$1",[s.invitation.response_id]);
 await purgeInvitations(f.db);
 const page=await listSubjectResponses(f.db,visitor.id);expect(page.items.length).toBeGreaterThan(0);
 const handle=(await f.admin.query("select handle from connect_response_subjects where response_id=$1",[s.invitation.response_id])).rows[0].handle;
 await applySubjectRights(f.db,"hc06b-owner",{handle,action:"erase"});
 expect((await f.admin.query("select status from campaign_responses where id=$1",[s.invitation.response_id])).rows[0].status).toBe("associated");
 await applySubjectRights(f.db,visitor.id,{handle,action:"withdraw",purpose:"newsletter"});
 const projected=(await f.admin.query("select c.purpose,c.status from contact_consents c join connect_consent_origins o on o.tenant_id=c.tenant_id and o.consent_id=c.id where o.response_id=$1 order by c.purpose,c.status",[s.invitation.response_id])).rows;
 expect(projected).toEqual([{purpose:"newsletter",status:"granted"},{purpose:"newsletter",status:"withdrawn"},{purpose:"outreach_follow_up",status:"granted"}]);
 expect((await listSubjectResponses(f.db,visitor.id)).items.find(i=>i.handle===handle)?.purposes).toEqual(["outreach_follow_up"]);
 await applySubjectRights(f.db,visitor.id,{handle,action:"erase"});
 expect((await f.admin.query("select count(*)::int as n from connect_response_subjects where handle=$1",[handle])).rows[0].n).toBe(0);
 expect((await f.admin.query("select count(*)::int as n from users where id=$1",[visitor.id])).rows[0].n).toBe(1);
});
it("carries receipt rights across association and scrubs source and canonical projection",async()=>{
 const s=await automaticFlow(["account_communications","newsletter"]);
 await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 await applyIntakeRights(f.db,{receiptToken:s.manifest.receiptToken,action:"withdraw",purpose:"newsletter"});
 expect((await f.admin.query("select count(*)::int as n from campaign_response_consents where response_id=$1 and status='withdrawn'",[s.invitation.response_id])).rows[0].n).toBe(1);
 await applyIntakeRights(f.db,{receiptToken:s.manifest.receiptToken,action:"erase"});
 expect((await f.admin.query("select count(*)::int as n from contact_source_events where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(0);
 expect((await f.admin.query("select count(*)::int as n from connect_claim_completions where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(0);
 await expect(consumeInvitation(f.db,s.flow,visitor,{action:"confirm"})).rejects.toMatchObject({status:409});
});
it("rolls back claim creation when a source is paused before confirmation",async()=>{
 const s=await automaticFlow();
 await transitionConnectLink(f.db,"hc06b-owner",tenant,s.campaign,s.link.id,{action:"disable"});
 await expect(consumeInvitation(f.db,s.flow,visitor,{action:"confirm"})).rejects.toMatchObject({status:409});
 expect((await f.admin.query("select count(*)::int as n from response_account_claims where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(0);
 expect((await f.admin.query("select consumed_at from connect_invitations where id=$1",[s.invitation.id])).rows[0].consumed_at).toBeNull();
});

it("erasing a withdrawing response cannot resurrect an older independent response grant",async()=>{
 const a=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,a.flow,visitor,{action:"confirm"});
 const b=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,b.flow,visitor,{action:"confirm"});
 const contact=(await f.admin.query("select contact_id from campaign_responses where id=$1",[a.invitation.response_id])).rows[0].contact_id;
 await applyIntakeRights(f.db,{receiptToken:b.manifest.receiptToken,action:"withdraw",purpose:"newsletter"});
 const original=(await f.admin.query("select c.occurred_at::text as occurred_at,c.recorded_at::text as recorded_at from contact_consents c join connect_consent_origins o on o.tenant_id=c.tenant_id and o.consent_id=c.id where o.response_id=$1 and c.status='withdrawn'",[b.invitation.response_id])).rows[0];
 await applyIntakeRights(f.db,{receiptToken:b.manifest.receiptToken,action:"erase"});
 const person=await getContact(f.db,"hc06b-owner",tenant,contact);
 expect(person.effectiveConsents.find(c=>c.purpose==="newsletter"&&c.channel==="email")?.status).toBe("withdrawn");
 expect((await f.admin.query("select occurred_at,recorded_at from contact_consents where contact_id=$1 and notice_version='subject-withdrawal' and occurred_at=$2 and recorded_at=$3",[contact,original.occurred_at,original.recorded_at])).rows).toHaveLength(1);
});
for(const priorResponseErasure of [false,true])it(`canonical contact erasure scrubs all associated evidence; prior response erased=${priorResponseErasure}`,async()=>{
 const s=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 const contact=(await f.admin.query("select contact_id from campaign_responses where id=$1",[s.invitation.response_id])).rows[0].contact_id;
 if(priorResponseErasure)await applyIntakeRights(f.db,{receiptToken:s.manifest.receiptToken,action:"erase"});
 await eraseContact(f.db,"hc06b-owner",tenant,contact);
 expect((await f.admin.query("select count(*)::int as n from contacts where id=$1",[contact])).rows[0].n).toBe(0);
 expect((await f.admin.query("select count(*)::int as n from contact_source_events where contact_id=$1",[contact])).rows[0].n).toBe(0);
 expect((await f.admin.query("select count(*)::int as n from connect_response_subjects where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(0);
 expect((await f.admin.query("select count(*)::int as n from users where id=$1",[visitor.id])).rows[0].n).toBe(1);
});
it("reports authenticated rights quota refusal instead of claiming success",async()=>{
 const {applySubjectRights}=await import("../../src/server/connect-subject-rights");
 const s=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 const handle=(await f.admin.query("select handle from connect_response_subjects where response_id=$1",[s.invitation.response_id])).rows[0].handle;
 await f.admin.query("insert into connect_intake_limits(key,count,expires_at) values($1,12,now()+interval '1 hour') on conflict(key) do update set count=12,expires_at=excluded.expires_at",["receipt:"+receiptHash(s.manifest.receiptToken)]);
 await expect(applySubjectRights(f.db,visitor.id,{handle,action:"withdraw",purpose:"newsletter"})).rejects.toMatchObject({status:429});
 expect((await f.admin.query("select count(*)::int as n from campaign_response_consents where response_id=$1 and status='withdrawn'",[s.invitation.response_id])).rows[0].n).toBe(0);
});

it("parallel confirmations serialize into one association and the same generic success",async()=>{
 const s=await automaticFlow();const pool=new Pool({connectionString:f.appURL,max:2,application_name:"hc06b-parallel"}),db=drizzle(pool,{schema});
 let attempts:Promise<unknown>[]=[];
 await f.admin.query("begin");
 try{
  await f.admin.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["connect-intake-receipt:"+receiptHash(s.manifest.receiptToken)]);
  attempts=[consumeInvitation(db,s.flow,visitor,{action:"confirm"}),consumeInvitation(db,s.flow,visitor,{action:"confirm"})];
  await expect.poll(async()=>{
   await f.admin.query("select pg_stat_clear_snapshot()");
   return (await f.admin.query("select count(*)::int as n from pg_stat_activity where application_name='hc06b-parallel' and wait_event_type='Lock'")).rows[0].n;
  },{timeout:5000}).toBe(2);
  await f.admin.query("commit");
  const outcomes=await Promise.all(attempts);expect(outcomes).toHaveLength(2);
  expect((await f.admin.query("select count(*)::int as n from contact_source_events where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(1);
 }finally{await f.admin.query("rollback");await Promise.allSettled(attempts);await pool.end();}
});

it("revalidates a disabled source after a real receipt lock wait",async()=>{
 const s=await automaticFlow(),pool=new Pool({connectionString:f.appURL,max:1,application_name:"hc06b-source-wait"}),db=drizzle(pool,{schema});
 let operation:Promise<unknown>|undefined;
 await f.admin.query("begin");
 try{
  await f.admin.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["connect-intake-receipt:"+receiptHash(s.manifest.receiptToken)]);
  operation=consumeInvitation(db,s.flow,visitor,{action:"confirm"}).then(value=>({value}),error=>({error}));
  await expect.poll(async()=>{await f.admin.query("select pg_stat_clear_snapshot()");return (await f.admin.query("select count(*)::int as n from pg_stat_activity where application_name='hc06b-source-wait' and wait_event_type='Lock'")).rows[0].n;},{timeout:5000}).toBe(1);
  await transitionConnectLink(f.db,"hc06b-owner",tenant,s.campaign,s.link.id,{action:"disable"});
  await f.admin.query("commit");
  expect(await operation).toMatchObject({error:{status:409}});
  expect((await f.admin.query("select count(*)::int as n from response_account_claims where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(0);
 }finally{await f.admin.query("rollback");await operation;await pool.end();}
});
it("keeps a live verified-user lock while authenticated rights wait on receipt serialization",async()=>{
 const {applySubjectRights}=await import("../../src/server/connect-subject-rights");
 const s=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 const handle=(await f.admin.query("select handle from connect_response_subjects where response_id=$1",[s.invitation.response_id])).rows[0].handle;
 const pool=new Pool({connectionString:f.appURL,max:1,application_name:"hc06b-rights-wait"}),db=drizzle(pool,{schema});
 const mutation=new Pool({connectionString:f.admin.options.connectionString,max:1});let operation:Promise<unknown>|undefined;
 await f.admin.query("begin");
 try{
  await f.admin.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["connect-intake-receipt:"+receiptHash(s.manifest.receiptToken)]);
  operation=applySubjectRights(db,visitor.id,{handle,action:"withdraw",purpose:"newsletter"});
  await expect.poll(async()=>{await f.admin.query("select pg_stat_clear_snapshot()");return (await f.admin.query("select count(*)::int as n from pg_stat_activity where application_name='hc06b-rights-wait' and wait_event_type='Lock'")).rows[0].n;},{timeout:5000}).toBe(1);
  await mutation.query("begin");await mutation.query("set local lock_timeout='50ms'");
  await expect(mutation.query("update users set email_verified=false where id=$1",[visitor.id])).rejects.toMatchObject({code:"55P03"});
  await mutation.query("rollback");await f.admin.query("commit");await operation;
 }finally{await f.admin.query("rollback");await mutation.query("rollback");await operation;await pool.end();await mutation.end();}
});
it("retention hides expired Connect sources immediately and purges associated evidence",async()=>{
 const {purgeIntake}=await import("../../src/server/connect-intake");
 const s=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 const contact=(await f.admin.query("select contact_id from campaign_responses where id=$1",[s.invitation.response_id])).rows[0].contact_id;
 const source=(await f.admin.query("select id from contact_source_events where response_id=$1",[s.invitation.response_id])).rows[0].id;
 await f.admin.query("update campaign_responses set expires_at=clock_timestamp()-interval '1 second' where id=$1",[s.invitation.response_id]);
 const person=await getContact(f.db,"hc06b-owner",tenant,contact);expect(person.sourceHistory?.some(event=>event.id===source)).toBe(false);
 expect((await purgeIntake(f.db)).purged).toBeGreaterThanOrEqual(1);
 expect((await f.admin.query("select count(*)::int as n from connect_response_subjects where response_id=$1",[s.invitation.response_id])).rows[0].n).toBe(0);
});
it("associated purpose rechecks honor a later canonical CRM withdrawal",async()=>{
 const {isConnectResponsePurposeActive}=await import("../../src/server/connect-responses");
 const s=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 const contact=(await f.admin.query("select contact_id from campaign_responses where id=$1",[s.invitation.response_id])).rows[0].contact_id;
 expect(await isConnectResponsePurposeActive(f.db,"hc06b-owner",tenant,s.invitation.response_id,"newsletter")).toBe(true);
 await recordConsent(f.db,"hc06b-owner",tenant,contact,{channel:"email",status:"withdrawn",purpose:"newsletter",noticeVersion:"notice-v1",source:"Privacy request",evidence:"Synthetic verified withdrawal"});
 expect(await isConnectResponsePurposeActive(f.db,"hc06b-owner",tenant,s.invitation.response_id,"newsletter")).toBe(false);
});
it("purpose rechecks use wall-clock expiry after waiting on membership locks",async()=>{
 const {isConnectResponsePurposeActive}=await import("../../src/server/connect-responses");
 const s=await automaticFlow(["account_communications","newsletter"]);await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 const pool=new Pool({connectionString:f.appURL,max:1,application_name:"hc06b-purpose-wait"}),db=drizzle(pool,{schema});let operation:Promise<unknown>|undefined;
 await f.admin.query("begin");
 try{
  await f.admin.query("select 1 from workspace_members where tenant_id=$1 and user_id='hc06b-owner' for update",[tenant]);
  operation=isConnectResponsePurposeActive(db,"hc06b-owner",tenant,s.invitation.response_id,"newsletter");
  await expect.poll(async()=>{await f.admin.query("select pg_stat_clear_snapshot()");return (await f.admin.query("select count(*)::int as n from pg_stat_activity where application_name='hc06b-purpose-wait' and wait_event_type='Lock'")).rows[0].n;},{timeout:5000}).toBe(1);
  await f.admin.query("update campaign_responses set expires_at=clock_timestamp()-interval '1 millisecond' where id=$1",[s.invitation.response_id]);
  await f.admin.query("commit");expect(await operation).toBe(false);
 }finally{await f.admin.query("rollback");await operation;await pool.end();}
});
it("account deletion removes durable capabilities without deleting the independent organizer contact",async()=>{
 const s=await automaticFlow();await consumeInvitation(f.db,s.flow,visitor,{action:"confirm"});
 const contact=(await f.admin.query("select contact_id from campaign_responses where id=$1",[s.invitation.response_id])).rows[0].contact_id;
 await f.admin.query("delete from users where id=$1",[visitor.id]);
 expect((await f.admin.query("select count(*)::int as n from connect_response_subjects where user_id=$1",[visitor.id])).rows[0].n).toBe(0);
 expect((await f.admin.query("select count(*)::int as n from connect_claim_completions where user_id=$1",[visitor.id])).rows[0].n).toBe(0);
 expect((await getContact(f.db,"hc06b-owner",tenant,contact)).erasedAt).toBeNull();
});

it("keeps the HC-03 response guard refusing an expired link after 0032 rebuilds it",async()=>{
  const campaign=(await createCampaign(f.db,"hc06b-owner",tenant,{name:"Expiry",type:"conference"},"hc06b-expiry")).id;
  const version=await publishIntakeForm(f.db,"hc06b-owner",tenant,campaign,{name:"Expiry",notice:"Synthetic only",retentionDays:1,
    purposes:["newsletter"],definition:{kind:"connect-intake-v3",syntheticOnly:true,preferredName:false,followUpChannel:"email"}});
  const link=await createConnectLink(f.db,"hc06b-owner",tenant,campaign,{formVersionId:version.id});
  await transitionConnectLink(f.db,"hc06b-owner",tenant,campaign,link.id,{action:"publish",expiresAt:new Date(Date.now()+1200).toISOString()});
  await new Promise(resolve=>setTimeout(resolve,1500));
  // Even a privileged direct insert must be refused once the link has expired.
  await expect(f.admin.query("insert into campaign_responses(tenant_id,campaign_id,link_id,form_version_id,public_submission_id,locale) values($1,$2,$3,$4,$5,'en')",
    [tenant,campaign,link.id,version.id,randomUUID()])).rejects.toThrow(/not accepting responses/);
});
