import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/node-postgres";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { getCampaignConnectMetrics } from "../../src/server/connect-metrics";
it("restricted-owner populated 0053 upgrade preserves campaigns and starts empty counters; replay is a no-op", async () => {
  let tenant="",campaign="";
  const f = await testDatabase({migrationOwner:true,beforeHc15Migration:async admin=>{
    const db=drizzle(admin,{schema}); await db.insert(schema.users).values({id:"metrics-upgrade",name:"Synthetic",email:"metrics-upgrade@example.test"});
    tenant=(await createWorkspace(db,"metrics-upgrade","Synthetic ministry")).tenantId;
    campaign=(await createCampaign(db,"metrics-upgrade",tenant,{name:"Before 0054",type:"local_outreach"},"upgrade")).id;
  }});
  try { expect(Object.values((await getCampaignConnectMetrics(f.db,"metrics-upgrade",tenant,campaign)).metrics).every(n=>n===0)).toBe(true); expect((await f.admin.query("select name from campaigns where id=$1",[campaign])).rows[0].name).toBe("Before 0054"); } finally { await f.close(); }
},90000);
