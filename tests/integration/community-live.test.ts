import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { withUser } from "../../src/server/tenancy";
import { autoCloseLiveEvents,listLiveEvents,saveLiveEvent } from "../../src/server/community-live";
import { liveAutoCloseDue,liveInWindow,liveStates,liveTransitionAllowed } from "../../src/lib/community-live";
vi.mock("server-only",()=>({}));
let f:Awaited<ReturnType<typeof testDatabase>>,a:string,b:string,club:string,other:string;
const raw=(state='scheduled',version=0)=>({title:'Live test',videoUrl:'https://youtu.be/dQw4w9WgXcQ',scheduledStart:new Date().toISOString(),state,version});
beforeAll(async()=>{
 f=await testDatabase({migrationOwner:true});
 vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('unexpected_network'));
 await f.db.insert(users).values(['l-owner','l-admin','l-mod','l-member','l-other','l-outsider','l-viewer','l-banned','l-bowner'].map(id=>({id,name:id,email:`${id}@example.test`,emailVerified:true})));
 a=(await createWorkspace(f.db,'l-owner','Live ministry','church')).tenantId;b=(await createWorkspace(f.db,'l-bowner','Other ministry','church')).tenantId;
 club=(await createCommunity(f.db,'l-owner',a,{name:'Live club',slug:'live-club'})).id;
 other=(await createCommunity(f.db,'l-owner',a,{name:'Other club',slug:'live-other'})).id;
 await createCommunity(f.db,'l-bowner',b,{name:'Third club',slug:'live-third'});
 await f.admin.query("update communities set status='published'");
 for(const [user,c,role,status] of [['l-mod',club,'moderator','active'],['l-member',club,'member','active'],['l-banned',club,'member','banned'],['l-other',other,'member','active']]){
  await f.admin.query('insert into community_memberships(tenant_id,community_id,user_id,role,status) values($1,$2,$3,$4,$5)',[a,c,user,role,status]);
  await f.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,$2,'community',$3,'admin_grant')",[a,user,c]);
 }
 await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,'l-admin','admin'),($1,'l-viewer','viewer')",[a]);
},90000);
afterAll(async()=>{expect(fetch).not.toHaveBeenCalled();vi.restoreAllMocks();await f?.close();});
it('RLS and service enforce tenant/community/membership/role boundaries',async()=>{
 const e=await saveLiveEvent(f.db,'l-owner','live-club',null,raw()) as {id:string};
 const foreign=await saveLiveEvent(f.db,'l-bowner','live-third',null,raw()) as {id:string};
 await saveLiveEvent(f.db,'l-owner','live-other',null,raw());
 await expect(listLiveEvents(f.db,'l-owner','live-third',foreign.id)).rejects.toMatchObject({status:404});
 for(const u of ['l-owner','l-admin','l-mod','l-member'])expect((await listLiveEvents(f.db,u,'live-club')).some(x=>x.id===e.id)).toBe(true);
 for(const u of ['l-other','l-outsider','l-viewer','l-banned','l-bowner']){
  expect(await listLiveEvents(f.db,u,'live-club')).toEqual([]);
  expect((await withUser(f.db,u,tx=>tx.execute(sql`select * from public.community_live_events where id=${e.id}::uuid`))).rows).toEqual([]);
  await expect(saveLiveEvent(f.db,u,'live-club',null,raw())).rejects.toMatchObject({status:404});
 }
 await expect(saveLiveEvent(f.db,'l-mod','live-club',null,raw())).rejects.toMatchObject({status:404});
 await expect(withUser(f.db,'l-owner',tx=>tx.execute(sql`update public.community_live_events set title='bypass'`))).rejects.toThrow();
 await expect(listLiveEvents(f.db,'l-member','live-other',e.id)).rejects.toMatchObject({status:404});
 const admin=await saveLiveEvent(f.db,'l-admin','live-club',null,raw()) as {id:string};expect(admin.id).toBeTruthy();
});
it('versions, state transitions, metadata audit and explicit replay',async()=>{
 const input=raw('draft'),e=await saveLiveEvent(f.db,'l-owner','live-club',null,input) as {id:string};
 await expect(listLiveEvents(f.db,'l-member','live-club',e.id)).rejects.toMatchObject({status:404});
 await saveLiveEvent(f.db,'l-owner','live-club',e.id,{...input,state:'scheduled',version:1});
 await expect(saveLiveEvent(f.db,'l-owner','live-club',e.id,{...input,state:'live',version:1})).rejects.toMatchObject({status:409});
 await expect(saveLiveEvent(f.db,'l-owner','live-club',e.id,{...input,state:'replay',version:2})).rejects.toMatchObject({status:400});
 await saveLiveEvent(f.db,'l-owner','live-club',e.id,{...input,state:'live',version:2});
 await saveLiveEvent(f.db,'l-owner','live-club',e.id,{...input,state:'ended',version:3});
 const ended=(await listLiveEvents(f.db,'l-member','live-club',e.id))[0];expect(ended.state).toBe('ended');
 await saveLiveEvent(f.db,'l-owner','live-club',e.id,{...input,state:'replay',version:4});
 const logs=(await f.admin.query("select metadata from audit_logs where target_id=$1 and action='community.live.save'",[e.id])).rows;
 expect(logs).toHaveLength(5);for(const l of logs)expect(Object.keys(l.metadata).sort()).toEqual(['communityId','from','to','version']);
});
it('window rules apply at RLS and revoked/banned members lose access',async()=>{
 const e=await saveLiveEvent(f.db,'l-owner','live-club',null,{...raw(),scheduledStart:new Date(Date.now()+25*3600000).toISOString()}) as {id:string};
 await expect(listLiveEvents(f.db,'l-member','live-club',e.id)).rejects.toMatchObject({status:404});
 expect((await withUser(f.db,'l-member',tx=>tx.execute(sql`select id from community_live_events where id=${e.id}::uuid`))).rows).toEqual([]);
 await f.admin.query("update community_live_events set scheduled_start=now()-interval '8 days' where id=$1",[e.id]);
 await expect(listLiveEvents(f.db,'l-member','live-club',e.id)).rejects.toMatchObject({status:404});
 await f.admin.query("update community_live_events set scheduled_start=now() where id=$1",[e.id]);
 await f.admin.query("update entitlements set revoked_at=now() where resource_id=$1 and user_id='l-member' and revoked_at is null",[club]);
 expect((await withUser(f.db,'l-member',tx=>tx.execute(sql`select id from community_live_events where id=${e.id}::uuid`))).rows).toEqual([]);
 expect(await listLiveEvents(f.db,'l-member','live-club')).toEqual([]);
 await f.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,'l-member','community',$2,'admin_grant')",[a,club]);
 await f.admin.query("update community_memberships set status='banned' where community_id=$1 and user_id='l-member'",[club]);
 expect(await listLiveEvents(f.db,'l-member','live-club')).toEqual([]);
 await f.admin.query("update community_memberships set status='active' where community_id=$1 and user_id='l-member'",[club]);
});
it('auto-close is scoped, idempotent, audited as system and never creates replay',async()=>{
 const input=raw(),e=await saveLiveEvent(f.db,'l-owner','live-club',null,input) as {id:string};
 await saveLiveEvent(f.db,'l-owner','live-club',e.id,{...input,state:'live',version:1});
 await f.admin.query("update community_live_events set started_at=now()-interval '12 hours' where id=$1",[e.id]);
 await expect(autoCloseLiveEvents(f.db,'l-mod','live-club')).rejects.toThrow();
 expect(await autoCloseLiveEvents(f.db,'l-owner','live-club')).toBe(1);expect(await autoCloseLiveEvents(f.db,'l-owner','live-club')).toBe(0);
 expect((await listLiveEvents(f.db,'l-owner','live-club',e.id))[0].state).toBe('ended');
 expect((await f.admin.query("select actor_id,metadata from audit_logs where target_id=$1 and action='community.live.auto_close'",[e.id])).rows).toEqual([{actor_id:null,metadata:{communityId:club,from:'live',to:'ended',version:3}}]);
});
it('SQL/TS state, window and auto-close parity; security properties',async()=>{
 for(const x of liveStates)for(const y of liveStates)expect((await f.admin.query('select public.community_live_transition_allowed($1,$2) as ok',[x,y])).rows[0].ok).toBe(liveTransitionAllowed(x,y));
 const start=new Date('2026-11-17T12:00:00Z');for(const state of liveStates)for(const d of [-86400001,-86400000,0,7*86400000,7*86400000+1]){
 const now=new Date(+start+d);expect((await f.admin.query('select public.community_live_in_window($1,$2,NULL,$3) as ok',[state,start,now])).rows[0].ok).toBe(liveInWindow(state,start,null,now));
 expect((await f.admin.query('select public.community_live_auto_close_due($1,$2,$3) as ok',[state,start,now])).rows[0].ok).toBe(liveAutoCloseDue(state,start,now));}
 expect((await f.admin.query("select relforcerowsecurity from pg_class where relname='community_live_events'")).rows[0].relforcerowsecurity).toBe(true);
 const funcs=(await f.admin.query("select proname,proconfig,has_function_privilege('public',oid,'execute') as public_exec from pg_proc where proname in ('community_live_save','community_live_auto_close','community_live_list')")).rows;
 for(const fn of funcs){expect(fn.public_exec).toBe(false);expect(fn.proconfig).toContain('search_path=pg_catalog, pg_temp');}
});
