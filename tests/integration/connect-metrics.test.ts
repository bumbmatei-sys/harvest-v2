import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { seedPeople } from "./social-layer-fixture";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { getCampaignConnectMetrics, metricKeys, suppressCampaignMetrics, type CampaignConnectMetrics } from "../../src/server/connect-metrics";
import { withTenant, withUser } from "../../src/server/tenancy";
let f: Awaited<ReturnType<typeof testDatabase>>, p: Awaited<ReturnType<typeof seedPeople>>, campaign: string;
beforeAll(async () => { f = await testDatabase({migrationOwner:true}); p = await seedPeople(f,"metrics"); campaign = (await createCampaign(f.db,p.owner,p.tenant,{name:"Synthetic",type:"local_outreach"},randomUUID())).id; },90000);
afterAll(async () => { await f?.close(); });
it("zero vector, owner/admin only, two ministries and unknown ids", async () => {
  const result = await getCampaignConnectMetrics(f.db,p.owner,p.tenant,campaign); expect(result.metrics).toEqual(Object.fromEntries(metricKeys.map(k=>[k,0])));
  expect(await getCampaignConnectMetrics(f.db,p.admin,p.tenant,campaign)).toEqual(result);
  for (const actor of [p.member,p.viewer,p.outsider]) await expect(getCampaignConnectMetrics(f.db,actor,p.tenant,campaign)).rejects.toMatchObject({status:403});
  await expect(getCampaignConnectMetrics(f.db,p.outsider,p.other,campaign)).rejects.toMatchObject({status:404});
  await expect(getCampaignConnectMetrics(f.db,p.owner,p.tenant,randomUUID())).rejects.toMatchObject({status:404});
  for (const actor of [p.member,p.viewer]) await expect(withUser(f.db,actor,async tx=>{ await tx.execute(sql`select set_config('app.tenant_id',${p.tenant},true)`); return tx.execute(sql`select public.connect_campaign_metrics(${p.tenant}::uuid,${campaign}::uuid)`); })).rejects.toBeTruthy();
});
it.each([0,1,2,3,4,5])("counter %s is suppressed in SQL and service", async n => {
  await f.admin.query("insert into campaign_scan_days(tenant_id,campaign_id,day,count) values($1,$2,current_date,$3) on conflict(tenant_id,campaign_id,day) do update set count=$3",[p.tenant,campaign,n]);
  expect((await getCampaignConnectMetrics(f.db,p.owner,p.tenant,campaign)).metrics.scans).toBe(n>0 && n<5?null:n);
});
it("SQL and TS suppression parity including complementary cells", async () => {
  for (const a of [0,1,4,5,8,10,11]) for (const b of [0,1,5,8,10]) { const v = { ...Object.fromEntries(metricKeys.map(k=>[k,0])),associated:a,verifiedClaims:a,requested:b } as CampaignConnectMetrics; const {rows:[r]} = await f.admin.query("select connect_suppress_metrics($1::jsonb) as result",[JSON.stringify(v)]); expect(r.result).toEqual(suppressCampaignMetrics(v)); }
});
it("counter schema is coarse and unreadable to application role; definer ACL/search path", async () => {
  expect((await f.admin.query("select column_name from information_schema.columns where table_name='campaign_scan_days' order by ordinal_position")).rows.map(r=>r.column_name)).toEqual(["tenant_id","campaign_id","day","count"]);
  await expect(withTenant(f.db,p.owner,p.tenant,"connect:publish",tx=>tx.execute(sql`select * from public.campaign_scan_days`))).rejects.toBeTruthy();
  expect((await f.admin.query("select relforcerowsecurity from pg_class where oid='campaign_scan_days'::regclass")).rows[0].relforcerowsecurity).toBe(true);
  const {rows:[r]} = await f.admin.query("select proconfig,prosecdef,EXISTS(select 1 from aclexplode(proacl) a where a.grantee=0 and privilege_type='EXECUTE') as public_exec from pg_proc where oid='connect_campaign_metrics(uuid,uuid)'::regprocedure"); expect(r.prosecdef).toBe(true); expect(r.public_exec).toBe(false); expect(r.proconfig).toContain("search_path=pg_catalog, pg_temp");
});

it("synthetic scans update only daily counters; disabled capture and paused/unknown codes write nothing", async () => {
  const link = await createConnectLink(f.db,p.owner,p.tenant,campaign,{});
  await transitionConnectLink(f.db,p.owner,p.tenant,campaign,link.id,{action:"publish"});
  const capture = (enabled: boolean, code: string) => f.db.transaction(async tx => { if(enabled) await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`); return tx.execute<{result:boolean}>(sql`select public.connect_record_scan('qr',${code}) as result`); });
  expect((await capture(false,link.publicCode)).rows[0].result).toBe(false);
  expect((await capture(true,"unknown")).rows[0].result).toBe(false);
  for(let i=0;i<5;i++) expect((await capture(true,link.publicCode)).rows[0].result).toBe(true);
  const {rows} = await f.admin.query("select count(*)::int as days,sum(count)::int as scans from campaign_scan_days where tenant_id=$1 and campaign_id=$2",[p.tenant,campaign]); expect(rows[0].days).toBe(1); expect(rows[0].scans).toBe(10);
  await transitionConnectLink(f.db,p.owner,p.tenant,campaign,link.id,{action:"disable"}); expect((await capture(true,link.publicCode)).rows[0].result).toBe(false);
});

it("SQL suppresses sums-based complements",async()=>{const {rows:[r]}=await f.admin.query("select connect_suppress_metrics($1::jsonb) as result",[JSON.stringify({associated:11,verifiedClaims:11,requested:5,closed:5})]); expect(Object.values(r.result).every(n=>n===null)).toBe(true);});
