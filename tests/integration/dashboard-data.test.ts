import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { crmTasks, users } from "../../src/db/schema";
import { changeMemberAccess } from "../../src/server/access";
import { createCampaign } from "../../src/server/campaigns";
import { campaignSummary, workspaceHome } from "../../src/server/dashboard-data";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace, putMember } from "../../src/server/workspaces";

let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, otherTenant: string, campaign: string, otherCampaign: string;
const owner = "dash-owner", other = "dash-other", staff = "dash-staff";
const peopleName = "Synthetic private person";
let now: Date;
beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic");
  vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "f".repeat(64));
  vi.stubEnv("DATABASE_URL", f.appURL);
  now = new Date();
  await f.db.insert(users).values([owner, other, staff].map(id => ({ id, name: id, email: `${id}@example.invalid` })));
  tenant = (await createWorkspace(f.db, owner, "Dashboard ministry")).tenantId;
  otherTenant = (await createWorkspace(f.db, other, "Other dashboard ministry")).tenantId;
  await putMember(f.db, owner, tenant, `${staff}@example.invalid`, "member");
  await changeMemberAccess(f.db, owner, tenant, { userId: staff, role: "collaborator", grants: { campaigns: "view" } });
  campaign = (await createCampaign(f.db, owner, tenant, { name: "Synthetic campaign", type: "conference" }, "dashboard-campaign")).id;
  otherCampaign = (await createCampaign(f.db, other, otherTenant, { name: "Other synthetic campaign", type: "conference" }, "other-dashboard-campaign")).id;
  await f.admin.query(`insert into contacts(tenant_id,name,created_at)
    select $1::uuid,$2::text,$3::timestamptz from generate_series(1,5)
    union all select $1::uuid,$2::text,$3::timestamptz - interval '1 week'`, [tenant, peopleName, now.toISOString()]);
  await withTenant(f.db, owner, tenant, "tasks:write", tx => tx.insert(crmTasks).values([
    { tenantId: tenant, title: "My assigned task", assigneeUserId: owner, createdBy: owner },
    { tenantId: tenant, title: "Someone else's task", assigneeUserId: staff, createdBy: owner },
  ]));
  const board = randomUUID();
  await f.admin.query("insert into campaign_boards(tenant_id,id,campaign_id,department,created_by) values($1,$2,$3,'general',$4)",
    [tenant, board, campaign, owner]);
  await f.admin.query(`insert into campaign_tasks(tenant_id,campaign_id,board_id,title,status,created_by,completed_at,completed_by)
    select $1,$2,$3,$4,'done',$5,now(),$5 from generate_series(1,5)`, [tenant, campaign, board, peopleName, owner]);
  await f.admin.query(`insert into campaign_tasks(tenant_id,campaign_id,board_id,title,created_by)
    values ($1,$2,$3,$4,$5)`, [tenant, campaign, board, peopleName, owner]);
  await f.admin.query(`insert into campaign_scan_days(tenant_id,campaign_id,day,count) values
    ($1,$2,timezone('UTC',now())::date-1,4),($1,$2,timezone('UTC',now())::date-2,9),($1,$2,timezone('UTC',now())::date-3,12)`, [tenant, campaign]);
  const client = await f.admin.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(`insert into newsletter_campaigns(tenant_id,id,name,created_by,state,frozen_at)
      values ($1,$2,'Synthetic newsletter',$3,'sent',now() - interval '1 day')`, [tenant, randomUUID(), owner]);
  } finally {
    await client.query("commit");
    client.release();
  }
}, 120_000);
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });

it("rejects a foreign ministry and a foreign campaign even for a ministry owner", async () => {
  await expect(workspaceHome(f.db, other, tenant)).rejects.toMatchObject({ status: 403 });
  await expect(campaignSummary(f.db, owner, tenant, otherCampaign)).rejects.toMatchObject({ status: 404 });
  await expect(campaignSummary(f.db, other, tenant, campaign)).rejects.toMatchObject({ status: 403 });
});

it("returns only the permitted blocks and masks every small chart count", async () => {
  const staffHome = await workspaceHome(f.db, staff, tenant, now);
  for (const area of ["peopleAdded", "giving", "newsletter", "upcomingEvents", "community", "social"]) expect(staffHome).not.toHaveProperty(area);
  const staffSummary = await campaignSummary(f.db, staff, tenant, campaign, now);
  expect(staffSummary.connect).toBeUndefined();
  expect(staffSummary.eventSignups).toBeUndefined();
  expect(staffSummary.tasks).toEqual([{ department: "general", open: [{ date: expect.any(String), value: null }],
    done: [{ date: expect.any(String), value: 5 }] }]);
  const ownerHome = await workspaceHome(f.db, owner, tenant, now);
  expect(ownerHome).toMatchObject({ smallGroupLabel: "Fewer than 5", upcomingEvents: [], newsletter: { campaigns: [{ sends: null, clicks: null }] } });
  expect(ownerHome.peopleAdded).toHaveLength(12);
  expect(ownerHome.peopleAdded?.slice(-2).map(row => row.value)).toEqual([null, 5]);
  expect(ownerHome.tasks).toEqual([{ id: expect.any(String), title: "My assigned task", due: null, source: "crm" }]);
  const summary = await campaignSummary(f.db, owner, tenant, campaign, now);
  expect(summary.connect?.scans).toHaveLength(30);
  expect(summary.connect?.scans.slice(-3).map(row => row.value)).toEqual([12, null, null]);
  expect(summary.connect?.responses.every(row => row.value === null)).toBe(true);
  expect(summary.eventSignups).toEqual([]);
  const values = JSON.stringify({ people: ownerHome.peopleAdded, community: ownerHome.community, newsletter: ownerHome.newsletter, summary });
  for (const detail of [peopleName, "Synthetic newsletter", staff, owner, "@example.invalid", "assignee", "responseId"]) {
    expect(values).not.toContain(detail);
  }
});

it("leaves the restricted Connect tables inaccessible and omits the block when intake is disabled", async () => {
  await expect(withTenant(f.db, staff, tenant, "workspace:read", tx => tx.execute("select * from campaign_scan_days"))).rejects.toMatchObject({ cause: { code: "42501" } });
  vi.stubEnv("HARVEST_CONNECT_INTAKE", "");
  expect((await campaignSummary(f.db, owner, tenant, campaign, now)).connect).toBeUndefined();
});
