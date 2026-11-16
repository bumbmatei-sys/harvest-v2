import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { hc13Fixture } from "./hc13-fixture";
import { followUpCaseStates } from "../../src/lib/follow-up-cases";
import { assignFollowUpCase, transitionFollowUpCase } from "../../src/server/follow-up-cases";
import { eraseConnectResponse } from "../../src/server/connect-responses";
import { getCampaignConnectMetrics } from "../../src/server/connect-metrics";
import { createCampaign } from "../../src/server/campaigns";
import { randomUUID } from "node:crypto";
let ctx:Awaited<ReturnType<typeof hc13Fixture>>;
beforeAll(async()=>{ctx=await hc13Fixture({migrationOwner:true});},90000);
afterAll(async()=>{vi.unstubAllEnvs();await ctx?.f.close();});
it("aggregates populated responses and every real case state, with no person data and no other-ministry contribution",async()=>{
  for(const state of followUpCaseStates) for(let i=0;i<5;i++) {
    const c=await ctx.seedCase(); let version=1;
    const move=async(to:string)=>{await transitionFollowUpCase(ctx.f.db,"d-owner",ctx.tenantA,c.caseId,{to,version});version++;};
    if(state==="withdrawn") { await ctx.withdrawCrm(c.contactId); continue; }
    if(state==="requested")continue;
    await move("awaiting_assignment");if(state==="awaiting_assignment")continue;
    await assignFollowUpCase(ctx.f.db,"d-owner",ctx.tenantA,c.caseId,{assigneeId:"d-member",version});version++;if(state==="assigned")continue;
    await move("attempted");if(state==="attempted")continue;
    if(state==="no_response"){await move("no_response");continue;}
    await move("connected");if(state==="closed")await move("closed");
  }
  for(let i=0;i<5;i++){await ctx.seedResponse();const erased=await ctx.seedResponse();await eraseConnectResponse(ctx.f.db,"d-owner",ctx.tenantA,erased);}
  const other=(await createCampaign(ctx.f.db,"d-other",ctx.tenantB,{name:"Other synthetic",type:"conference"},randomUUID())).id;
  await ctx.f.admin.query("insert into campaign_scan_days(tenant_id,campaign_id,day,count) values($1,$2,current_date,15)",[ctx.tenantB,other]);
  const {metrics}=await getCampaignConnectMetrics(ctx.f.db,"d-owner",ctx.tenantA,ctx.campaign);
  expect(metrics).toEqual({scans:0,pending:5,associated:40,erased:5,verifiedClaims:40,...Object.fromEntries(followUpCaseStates.map(s=>[s,5]))});
  expect((await getCampaignConnectMetrics(ctx.f.db,"d-other",ctx.tenantB,other)).metrics.scans).toBe(15);
  expect(Object.values(metrics).every(v=>typeof v==="number")).toBe(true);
  // One associated response without a case must never be exposed by subtracting the sum of all case states.
  await ctx.seedAssociated(); expect(Object.values((await getCampaignConnectMetrics(ctx.f.db,"d-owner",ctx.tenantA,ctx.campaign)).metrics).every(v=>v===null)).toBe(true);
},90000);
