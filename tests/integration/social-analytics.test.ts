import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { readSocialAnalytics, readSocialPostAnalytics } from "../../src/server/social/analytics";
import { runSocialAnalyticsRefresh, SOCIAL_ANALYTICS_REFRESH_ENABLED } from "../../src/server/social/analytics-worker";
import { SocialProviderError } from "../../src/server/social/port";
import { schedulePost, linkConnection, setConnectionEnabled } from "../../src/server/social/service";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";
import { CANARY, depsFor, newFake, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
const fake = newFake(), deps=depsFor(fake);
let f:Awaited<ReturnType<typeof testDatabase>>, p:Awaited<ReturnType<typeof seedPeople>>, ig:string, fb:string, yt:string;
let planner:{id:string;ref:string};
let network:ReturnType<typeof noNetwork>;
const utcDay = (delta:number) => new Date(Date.now()+delta*86_400_000).toISOString().slice(0,10);
const report = (fields:Record<string,string>={},who?:string,tenant?:string) => readSocialAnalytics(f.db,who ?? p.owner,tenant ?? p.tenant,
  new URLSearchParams({from:utcDay(-2),to:utcDay(0),...fields}),deps);
const run = () => runSocialAnalyticsRefresh(f.workerPool,fake);
const q = (query:string,values?:unknown[]) => f.admin.query(query,values);
const forceDue = (id:string) => q("update social_analytics_refresh set due_at=now()-interval '1 second' where connection_id=$1",[id]);
const metric = (ref:string,metrics:{likes?:number;reach?:number;views?:number}, publishedAt=new Date(Date.now()-60_000)) => ({ ref,publishedAt,metrics });
const snapshot = (id:string,ref:string,captured:string,published:string,values:object,tenant=p.tenant) => q(`insert into social_analytics_posts
  (tenant_id,connection_id,provider_ref,day,captured_at,published_at,metrics)
  values($1,$2,$3,($4::timestamptz at time zone 'UTC')::date,$4,$5,$6)`,[tenant,id,ref,captured,published,values]);
beforeAll(async () => {
  f=await testDatabase({migrationOwner:true});
  p=await seedPeople(f,"analytics");
  useTestKeys();
  network=noNetwork();
  const link = async (accountRef:string,tenant=p.tenant,user=p.owner) =>
    (await linkConnection(f.db,user,tenant,{provider:"fake",credential:CANARY,accountRef},deps)).connection.id;
  ig=await link("acc-ig-1"); yt=await link("acc-yt-3"); fb=await link("acc-fb-2",p.other,p.outsider);
  const {post}=await schedulePost(f.db,p.owner,p.tenant,{connectionId:ig,content:"planner-content-canary",
    scheduledFor:new Date(Date.now()+60_000).toISOString()},deps);
  await q("update social_posts set scheduled_for=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where id=$1",[post.id]);
  expect(await runSocialPublisher(f.workerPool,()=>fake)).toMatchObject({published:1});
  const {rows:[row]}=await q("select provider_post_ref from social_posts where id=$1",[post.id]);
  planner={id:post.id,ref:row.provider_post_ref};
});
beforeEach(async () => {
  await q("truncate social_analytics_accounts, social_analytics_posts, social_analytics_refresh, social_analytics_times");
  fake.analyticsPosts.clear();
  fake.analyticsAccounts.clear();
  fake.analyticsTimes.clear();
});
afterAll(async () => {
  if (network) expect(network).not.toHaveBeenCalled();
  network?.mockRestore();
  useKeyProvider(null);
  await f?.close();
});

it("enforces two-ministry isolation, neutral 404s and FORCE RLS through the app role", async () => {
  fake.analyticsPosts.set("acc-ig-1",[metric("ig-post",{likes:4})]);
  fake.analyticsPosts.set("acc-fb-2",[metric("fb-post",{likes:8})]);
  await run();
  const RLS = await q("select relrowsecurity,relforcerowsecurity from pg_class where relkind='r' and relname like 'social_analytics_%'");
  expect(RLS.rows).toHaveLength(4);
  expect(RLS.rows.every(row=>row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  expect((await report({},p.admin)).accounts.map(row=>row.id)).toContain(ig);
  expect((await report({},p.outsider,p.other)).accounts.map(row=>row.id)).toEqual([fb]);
  for (const user of [p.member,p.viewer,p.outsider]) await expect(report({},user)).rejects.toMatchObject({status:404});
  await expect(report({connectionId:fb})).rejects.toMatchObject({status:404});
  await expect(withTenant(f.db,p.owner,p.tenant,"social:analytics",async tx=>{
    await tx.execute(sql`delete from social_analytics_posts`);
  })).rejects.toThrow();
  const client=await f.pool.connect();
  try {
    for (const user of [p.viewer,p.member,p.outsider,p.owner]) {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true), set_config('app.social_analytics_worker','on',true)",[p.tenant,user]);
      const {rows}=await client.query("select provider_ref from social_analytics_posts order by provider_ref");
      expect(rows).toEqual(user===p.owner ? [{provider_ref:"ig-post"}] : []);
      await client.query("rollback");
    }
  } finally { client.release(); }
});

it("distinguishes measured zero from unavailable and excludes analytics text from storage", async () => {
  fake.analyticsPosts.set("acc-ig-1",[{...metric(planner.ref,{likes:0,reach:0}),metrics:{likes:0,reach:0,body:"post-body-canary"} as unknown as {likes:number}}]);
  fake.analyticsPosts.set("acc-yt-3",[metric("yt-post",{likes:0})]);
  await run();
  const result=await report({connectionId:ig,metric:"reach"});
  expect(result.summary.reach).toEqual({value:0,availability:"available"});
  expect(result.summary.impressions).toEqual({value:null,availability:"unavailable"});
  expect(result.topPosts[0]).toMatchObject({plannerPostId:planner.id,metrics:{likes:{value:0,availability:"available"}}});
  expect(result.bottomPosts[0].ref).toBe(planner.ref);
  expect(result.bestTimes.heatmap.find(slot=>slot.samples)).toMatchObject({averageEngagement:0,samples:1});
  expect(JSON.stringify(result)).not.toMatch(/post-body-canary|planner-content-canary/);
  expect(JSON.stringify((await q("select metrics from social_analytics_posts")).rows)).not.toContain("post-body-canary");
  for (const values of [{likes:"post-body-canary"},{likes:{number:1}},{message:"post-body-canary"}]) {
    await expect(snapshot(ig,randomUUID(),"2026-11-20T10:00:00Z","2026-11-19T10:00:00Z",values)).rejects.toMatchObject({code:"23514"});
  }
});

it("links a post detail only through its visible published planner record", async () => {
  fake.analyticsPosts.set("acc-ig-1",[{...metric("provider-analytics-ref",{likes:2}),nativeRef:planner.ref}]);
  await run();
  const dates=new URLSearchParams({from:utcDay(-1),to:utcDay(0),metric:"likes"});
  const detail=await readSocialPostAnalytics(f.db,p.owner,p.tenant,planner.id,dates,deps);
  expect(detail.post).toMatchObject({plannerPostId:planner.id,ref:"provider-analytics-ref",metrics:{likes:{value:2}}});
  await expect(readSocialPostAnalytics(f.db,p.outsider,p.other,planner.id,dates,deps)).rejects.toMatchObject({status:404});
  await expect(readSocialPostAnalytics(f.db,p.owner,p.tenant,randomUUID(),dates,deps)).rejects.toMatchObject({status:404});
});

it("leases refresh work once and upserts one numeric snapshot per stable key per day", async () => {
  expect(SOCIAL_ANALYTICS_REFRESH_ENABLED).toBe(false);
  fake.analyticsPosts.set("acc-ig-1",[metric("same-post",{likes:2}),metric("same-post",{likes:3})]);
  const a=await run();
  expect(a).toMatchObject({claimed:3,completed:3,stale:0});
  expect(await run()).toMatchObject({claimed:0,completed:0});
  await forceDue(ig);
  fake.analyticsPosts.set("acc-ig-1",[metric("same-post",{likes:4})]);
  const results=await Promise.all([run(),run()]);
  expect(results.reduce((sum,r)=>sum+r.claimed,0)).toBe(1);
  expect((await q("select metrics from social_analytics_posts where connection_id=$1",[ig])).rows).toEqual([{metrics:{likes:4}}]);
});

it("refuses application worker calls and direct worker table reads or writes", async () => {
  for (const name of ["claim","prune"]) await expect(f.pool.query(`select public.social_analytics_${name}(1)`)).rejects.toMatchObject({code:"42501"});
  await expect(f.workerPool.query("select * from social_analytics_refresh")).rejects.toMatchObject({code:"42501"});
  await expect(f.workerPool.query("delete from social_analytics_posts")).rejects.toMatchObject({code:"42501"});
  await expect(snapshot(fb,"cross-tenant","2026-11-20T10:00Z","2026-11-19T10:00Z",{})).rejects.toMatchObject({code:"23503"});
  await expect(q(`insert into social_analytics_posts (tenant_id,connection_id,provider_ref,planner_post_id,day,captured_at,published_at,metrics)
    values($1,$2,'wrong-account',$3,'2026-11-20','2026-11-20T10:00Z','2026-11-19T10:00Z','{}')`,[p.tenant,yt,planner.id]))
    .rejects.toMatchObject({code:"23503"});
});

it("expires old daily snapshots, cascades their heatmaps and is safe to rerun", async () => {
  const old=utcDay(-398), kept=utcDay(-397);
  for (const [day,ref] of [[old,"old"],[kept,"kept"]]) {
    await snapshot(ig,ref,`${day}T10:00:00Z`,`${day}T09:00:00Z`,{likes:0});
    await q("insert into social_analytics_accounts values($1,$2,$3,now(),'{\"followers\":1}')",[p.tenant,ig,day]);
    await q("insert into social_analytics_times values($1,$2,$3,0,0,1,1)",[p.tenant,ig,day]);
  }
  expect(await run()).toMatchObject({pruned:2});
  expect((await q("select provider_ref from social_analytics_posts")).rows).toEqual([{provider_ref:"kept"}]);
  expect((await q("select day::text from social_analytics_times")).rows).toEqual([{day:kept}]);
  expect(await run()).toMatchObject({pruned:0});
});

it("uses civil day boundaries through a DST fold and differences cumulative snapshots", async () => {
  const range={from:"2026-11-01",to:"2026-11-01",timezone:"America/New_York",connectionId:ig,metric:"likes"};
  await snapshot(ig,"old","2026-11-01T03:59:00Z","2026-10-30T04:00:00Z",{likes:2});
  await snapshot(ig,"old","2026-11-02T04:59:00Z","2026-10-30T04:00:00Z",{likes:6});
  await snapshot(ig,"fold-1","2026-11-01T05:35:00Z","2026-11-01T05:30:00Z",{likes:1});
  await snapshot(ig,"fold-2","2026-11-02T04:59:00Z","2026-11-01T06:30:00Z",{likes:2});
  await snapshot(ig,"next-day","2026-11-02T05:05:00Z","2026-11-02T05:00:00Z",{likes:999});
  const result=await report(range);
  expect(result.summary.published.value).toBe(2);
  expect(result.summary.engagement.value).toBe(7);
  expect(result.series.points).toEqual([{day:"2026-11-01",value:7,availability:"partial"}]);
  expect(result.bestTimes.heatmap.find(slot=>slot.samples)).toEqual({day:6,hour:1,averageEngagement:1.5,samples:2});
  await expect(report({from:"2026-11-02",to:"2026-11-01"})).rejects.toMatchObject({details:{code:"ANALYTICS_INVALID_RANGE"}});
  await expect(report({timezone:"not/a-timezone"})).rejects.toMatchObject({details:{code:"ANALYTICS_INVALID_RANGE"}});
});

it("derives follower changes from a real baseline and exposes provider UTC recommendation slots", async () => {
  fake.analyticsAccounts.set("acc-ig-1",[
    {day:utcDay(-3),metrics:{followers:20}},{day:utcDay(-2),metrics:{followers:20,profileViews:0}},
    {day:utcDay(-1),metrics:{followers:21,profileViews:4}},{day:utcDay(0),metrics:{followers:26,profileViews:2}},
  ]);
  fake.analyticsTimes.set("acc-ig-1",[{day:5,hour:10,engagement:32,samples:2}]);
  await run();
  const result=await report({connectionId:ig,metric:"followerChange",timezone:"Europe/Bucharest"});
  expect(result.summary.followerChange).toEqual({value:6,availability:"available"});
  expect(result.series.points.map(point=>point.value)).toEqual([0,1,5]);
  expect(result.bestTimes.provider.timezone).toBe("UTC");
  expect(result.bestTimes.provider.heatmap.find(slot=>slot.samples)).toEqual({day:5,hour:10,averageEngagement:32,samples:2});
  expect((await report({connectionId:ig,metric:"profileViews"})).series.points.map(point=>point.value)).toEqual([0,4,2]);
});

it("keeps data and marks delayed and expired connections as partial", async () => {
  fake.analyticsPosts.set("acc-ig-1",[metric("prior-post",{likes:3})]);
  await run();
  await forceDue(ig);
  const original=fake.readPostAnalytics.bind(fake);
  const spy=vi.spyOn(fake,"readPostAnalytics").mockImplementation(async (creds,query)=>{
    if (query.accountRef==="acc-ig-1") throw new SocialProviderError("RATE_LIMITED",120_000);
    return original(creds,query);
  });
  try { await run(); } finally { spy.mockRestore(); }
  expect(await report({connectionId:ig})).toMatchObject({partial:true,summary:{engagement:{value:3,availability:"partial"}},retryAfter:expect.any(Number),
    accounts:[{status:"partial",lastRefreshedAt:expect.any(String)}]});
  await setConnectionEnabled(f.db,p.owner,p.tenant,ig,false,deps);
  expect(await report({connectionId:ig})).toMatchObject({partial:true,accounts:[{status:"expired",connectionState:"disabled"}]});
});
