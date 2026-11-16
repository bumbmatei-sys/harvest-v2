import { expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({ user:vi.fn(), metrics:vi.fn(), db:{} }));
vi.mock("@/db/client",()=>({getDb:()=>mocks.db}));
vi.mock("@/server/http",()=>({verifiedUser:mocks.user,errorResponse:(error:unknown)=>Response.json({error:"unavailable"},{status:(error as {status:number}).status??500})}));
vi.mock("@/server/connect-metrics",()=>({getCampaignConnectMetrics:mocks.metrics}));
import { GET } from "../../src/app/api/workspaces/[tenantId]/campaigns/[campaignId]/connect-metrics/route";
it("authenticated GET forwards scope and returns private no-store metrics only",async()=>{
  mocks.user.mockResolvedValue("verified-user");mocks.metrics.mockResolvedValue({metrics:{scans:null}});
  const response=await GET(new Request("https://example.test"),{params:Promise.resolve({tenantId:"tenant",campaignId:"campaign"})});
  expect(mocks.metrics).toHaveBeenCalledWith(mocks.db,"verified-user","tenant","campaign");expect(await response.json()).toEqual({metrics:{scans:null}});expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("denied sessions do not call metrics service",async()=>{mocks.metrics.mockClear();mocks.user.mockRejectedValue({status:401});const response=await GET(new Request("https://example.test"),{params:Promise.resolve({tenantId:"tenant",campaignId:"campaign"})});expect(response.status).toBe(401);expect(mocks.metrics).not.toHaveBeenCalled();});
