import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users, contactSourceEvents } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, getContact, listContacts } from "../../src/server/contacts";
import { commitImport, createImport, previewImport, rollbackImport, updateImport } from "../../src/server/crm-imports";
import { mergeContacts } from "../../src/server/crm-merge";
import { withTenant } from "../../src/server/tenancy";
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, foreign: string;
beforeAll(async () => {
 f=await testDatabase({beforeHc06aMigration:async admin=>{
  await admin.query("insert into users(id,name,email) values('legacy-source-owner','Legacy','legacy-source@example.test')");
  const {rows:[workspace]}=await admin.query("insert into workspaces(name,created_by) values('Legacy source','legacy-source-owner') returning tenant_id");
  await admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,'legacy-source-owner','owner')",[workspace.tenant_id]);
  await admin.query("insert into contacts(tenant_id,name) values($1,'Unproven legacy origin')",[workspace.tenant_id]);
 }});
 await f.db.insert(users).values(['source-owner','source-member','source-other'].map(id=>({id,name:id,email:`${id}@example.test`})));
 tenant=(await createWorkspace(f.db,'source-owner','Sources')).tenantId;
 foreign=(await createWorkspace(f.db,'source-other','Other')).tenantId;
 await putMember(f.db,'source-owner',tenant,'source-member@example.test','member');
});
afterAll(async()=>{await f?.close();});
async function imported(email: string, fill=false) {
 let record=await createImport(f.db,'source-owner',tenant,{entity:'person',clientKey:randomUUID(),fileName:'synthetic.csv',csv:`Name,Email,Notes\nSynthetic,${email},Imported note`});
 if(fill) record=await updateImport(f.db,'source-owner',tenant,record.id,{version:record.version,onMatch:'fill'});
 await previewImport(f.db,'source-owner',tenant,record.id,{version:record.version});
 await commitImport(f.db,'source-owner',tenant,record.id);
 return record.id;
}
it('records manual activity atomically and hides source payloads and SQL rows from members/foreign tenants', async()=>{
 const person=await createContact(f.db,'source-member',tenant,{name:'Manual'});
 expect((await getContact(f.db,'source-owner',tenant,person.id)).sourceHistory?.map(x=>x.kind)).toEqual(['manual']);
 expect((await getContact(f.db,'source-member',tenant,person.id))).not.toHaveProperty('sourceHistory');
 expect((await listContacts(f.db,'source-member',tenant)).rows[0]).not.toHaveProperty('sourceKinds');
 expect(await withTenant(f.db,'source-member',tenant,'contacts:read',tx=>tx.select().from(contactSourceEvents))).toEqual([]);
 expect(await withTenant(f.db,'source-other',foreign,'contacts:read',tx=>tx.select().from(contactSourceEvents))).toEqual([]);
 await expect(withTenant(f.db,'source-owner',tenant,'contacts:write',tx=>tx.insert(contactSourceEvents).values({tenantId:tenant,contactId:person.id,kind:'manual',outcome:'created'}))).rejects.toThrow();
});
it('records imports once without a spurious manual origin and allows rollback to remove new contacts',async()=>{
 const id=await imported('source-new@example.test');
 const person=(await listContacts(f.db,'source-owner',tenant,{q:'source-new@example.test'})).rows[0];
 expect(person.sourceKinds).toEqual(['csv_import']);
 expect((await getContact(f.db,'source-owner',tenant,person.id)).sourceHistory).toHaveLength(1);
 await commitImport(f.db,'source-owner',tenant,id);
 expect((await getContact(f.db,'source-owner',tenant,person.id)).sourceHistory).toHaveLength(1);
 expect((await rollbackImport(f.db,'source-owner',tenant,id)).result.removed).toBe(1);
 expect((await f.admin.query('select * from contact_source_events where contact_id=$1',[person.id])).rows).toEqual([]);
});
it('keeps independent origins, labels reverted fills, and scrubs merge/erase history',async()=>{
 const first=await createContact(f.db,'source-owner',tenant,{name:'Existing',email:'source-fill@example.test'});
 const id=await imported('source-fill@example.test',true);
 expect((await getContact(f.db,'source-owner',tenant,first.id)).sourceHistory).toHaveLength(2);
 expect((await rollbackImport(f.db,'source-owner',tenant,id)).result.reverted).toBe(1);
 expect((await getContact(f.db,'source-owner',tenant,first.id)).sourceHistory?.some(x=>x.revertedAt)).toBe(true);
 const other=await createContact(f.db,'source-owner',tenant,{name:'Merge target'});
 const fresh=await getContact(f.db,'source-owner',tenant,first.id);
 await mergeContacts(f.db,'source-owner',tenant,other.id,{sourceId:first.id,targetVersion:other.version,sourceVersion:fresh.version});
 expect((await getContact(f.db,'source-owner',tenant,other.id)).sourceHistory).toHaveLength(3);
 await eraseContact(f.db,'source-owner',tenant,other.id);
 expect((await f.admin.query('select * from contact_source_events where contact_id=any($1::uuid[])',[[first.id,other.id]])).rows).toEqual([]);
});
it('leaves skipped imports out of provenance',async()=>{
 const person=await createContact(f.db,'source-owner',tenant,{name:'Skip',email:'source-skip@example.test'});
 await imported('source-skip@example.test');
 expect((await getContact(f.db,'source-owner',tenant,person.id)).sourceHistory?.map(x=>x.kind)).toEqual(['manual']);
});
it('denies forged completion/rollback and derives the target from immutable CSV cells',async()=>{
 const untouched=await createContact(f.db,'source-owner',tenant,{name:'Unrelated',email:'unrelated-source@example.test'});
 const item=await createImport(f.db,'source-owner',tenant,{entity:'person',clientKey:randomUUID(),fileName:'source.csv',csv:'Name,Email\nActual CSV,actual-csv@example.test'});
 await previewImport(f.db,'source-owner',tenant,item.id,{version:item.version});
 await expect(withTenant(f.db,'source-owner',tenant,'crm:import',tx=>tx.execute(`update crm_import_rows set contact_id='${untouched.id}',created=true,status='done' where import_id='${item.id}'`))).rejects.toThrow();
 await commitImport(f.db,'source-owner',tenant,item.id);
 await expect(withTenant(f.db,'source-owner',tenant,'crm:import',tx=>tx.execute(`update crm_import_rows set status='rolled_back' where import_id='${item.id}'`))).rejects.toThrow();
 expect((await getContact(f.db,'source-owner',tenant,untouched.id)).sourceHistory?.map(x=>x.kind)).toEqual(['manual']);
});
it('rejects invalid ready rows inside the controlled database writer',async()=>{
 for(const [header,bad] of [['Email','invalid'],['Phone','123'],['Social','bad handle'],['Title','x'.repeat(101)]] as const){
 const item=await createImport(f.db,'source-owner',tenant,{entity:'person',clientKey:randomUUID(),fileName:'invalid.csv',csv:`Name,${header}\nInvalid,${bad}`});
 await expect(withTenant(f.db,'source-owner',tenant,'crm:import',async tx=>{
  await tx.execute(`update crm_imports set status='running' where id='${item.id}'`);
  await tx.execute(`update crm_import_rows set status='ready' where import_id='${item.id}'`);
  await tx.execute(`select public.apply_person_import_row('${tenant}','${item.id}',1,null)`);
 })).rejects.toThrow();
 }
});
it('trims surrounding whitespace without inventing old origins',async()=>{
 const id=await imported('trim-source@example.test');
 const person=(await listContacts(f.db,'source-owner',tenant,{q:'trim-source@example.test'})).rows[0];
 expect(person.sourceKinds).toEqual(['csv_import']);
 await rollbackImport(f.db,'source-owner',tenant,id);
});

it('upgrades populated contacts without backfilling invented origins',async()=>{
 const {rows:[legacy]}=await f.admin.query("select id,tenant_id from contacts where name='Unproven legacy origin'");
 expect((await getContact(f.db,'legacy-source-owner',legacy.tenant_id,legacy.id)).sourceHistory).toEqual([]);
});
it('revalidates an identifier changed while waiting for the contact lock',async()=>{
 const person=await createContact(f.db,'source-owner',tenant,{name:'Race',email:'source-race@example.test'});
 let item=await createImport(f.db,'source-owner',tenant,{entity:'person',clientKey:randomUUID(),fileName:'race.csv',csv:'Name,Email,Notes\nRace,source-race@example.test,Must not fill'});
 item=await updateImport(f.db,'source-owner',tenant,item.id,{version:item.version,onMatch:'fill'});
 await previewImport(f.db,'source-owner',tenant,item.id,{version:item.version});
 await f.admin.query('begin');
 try{
 await f.admin.query('update contacts set version=version+1 where id=$1',[person.id]);
 await f.admin.query("update contact_identifiers set value='source-race-changed@example.test',normalized_value='source-race-changed@example.test' where contact_id=$1 and kind='email'",[person.id]);
 const committing=commitImport(f.db,'source-owner',tenant,item.id);
 let waiting=false;
 for(let i=0;i<100;i++){
  await f.admin.query('select pg_stat_clear_snapshot()');
  const {rows:[state]}=await f.admin.query("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like 'select public.apply_person_import_row%') as waiting");
  if(state.waiting){waiting=true;break;}
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 await f.admin.query('commit');
 expect(waiting).toBe(true);
 expect((await committing).stats.failed).toBe(1);
 expect((await getContact(f.db,'source-owner',tenant,person.id)).notes).toBe('');
 }finally{await f.admin.query('rollback');}
});
it('preserves ECMAScript whitespace normalization for names and email',async()=>{
 const item=await createImport(f.db,'source-owner',tenant,{entity:'person',clientKey:randomUUID(),fileName:'trim.csv',csv:'Name,Email\n\u00a0Trimmed\ufeff,\u00a0unicode-trim@example.test\ufeff'});
 await previewImport(f.db,'source-owner',tenant,item.id,{version:item.version});
 expect((await commitImport(f.db,'source-owner',tenant,item.id)).stats.created).toBe(1);
 expect((await listContacts(f.db,'source-owner',tenant,{q:'unicode-trim@example.test'})).rows[0].name).toBe('Trimmed');
});
