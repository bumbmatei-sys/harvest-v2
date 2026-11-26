import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { changeMemberAccess } from "../../src/server/access";
import { withTenant } from "../../src/server/tenancy";
import { saveEvent, transitionEvent } from "../../src/server/events";
import { campaignEventCandidates, listCampaignEvents, setCampaignEvent } from "../../src/server/campaign-events";
import { getChecklist } from "../../src/server/campaign-checklist";
import { getCampaignOverview } from "../../src/server/campaign-overview";

// Campaign events (founder approval, 26 Nov): a campaign links existing Events records. Runs under a restricted migration owner so definer policies are real.
const people = ["ce-owner", "ce-admin", "ce-member", "ce-viewer", "ce-campaigns", "ce-events", "ce-other"];
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string, community: string, campaign: string, second: string, foreignCampaign: string;
const when = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number }) => error.status ?? 500);
async function event(publish: boolean, owner = "ce-owner", ministry = () => tenant) {
  const id = randomUUID();
  await saveEvent(f.db, owner, ministry(), id, { version: 0, title: `Outreach ${id.slice(0, 4)}`, description: "", timeZone: "UTC", startsAt: when(60), endsAt: when(120) });
  if (publish) await transitionEvent(f.db, owner, ministry(), id, { action: "publish", version: 1 });
  return id;
}
const campaignRow = async (ministry: string, owner: string, name: string) =>
  (await f.admin.query("insert into campaigns (tenant_id, owner_user_id, type, name, idempotency_key, fingerprint) values ($1,$2,'conference',$3,$4,repeat('a',64)) returning id", [ministry, owner, name, randomUUID()])).rows[0].id as string;
const link = (user: string, eventId: string, linked = true, id = campaign) => setCampaignEvent(f.db, user, tenant, id, { eventId, linked });
const ids = async (user: string, id = campaign) => (await listCampaignEvents(f.db, user, tenant, id))!.events.map((e) => e.id);

beforeAll(async () => {
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "ce-owner", "Campaign events ministry", "church")).tenantId;
  other = (await createWorkspace(f.db, "ce-other", "Other ministry", "church")).tenantId;
  for (const [id, role] of [["ce-admin", "admin"], ["ce-member", "member"], ["ce-viewer", "viewer"], ["ce-campaigns", "viewer"], ["ce-events", "viewer"]] as const)
    await putMember(f.db, "ce-owner", tenant, `${id}@example.test`, role);
  await changeMemberAccess(f.db, "ce-owner", tenant, { userId: "ce-campaigns", role: "collaborator", grants: { campaigns: "manage" } });
  await changeMemberAccess(f.db, "ce-owner", tenant, { userId: "ce-events", role: "collaborator", grants: { communities: "manage", campaigns: "view" } });
  community = (await createCommunity(f.db, "ce-owner", tenant, { name: "Outreach circle", slug: "ce-outreach" })).id;
  await f.admin.query("update communities set status='published' where id=$1", [community]);
  campaign = await campaignRow(tenant, "ce-owner", "City outreach");
  second = await campaignRow(tenant, "ce-owner", "Second");
  foreignCampaign = await campaignRow(other, "ce-other", "Elsewhere");
}, 120000);
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });

it("links existing events, lists them for Events managers, audits changes and never changes the event", async () => {
  const draft = await event(false), published = await event(true);
  const offered = (await campaignEventCandidates(f.db, "ce-admin", tenant, campaign)).map((e) => e.id);
  expect(offered).toEqual(expect.arrayContaining([draft, published]));
  expect((await link("ce-owner", draft)).events.map((e) => e.id)).toEqual([draft]);
  expect((await link("ce-admin", published)).events.map((e) => e.id).sort()).toEqual([draft, published].sort());
  await link("ce-admin", published); // idempotent, not audited twice
  expect(await campaignEventCandidates(f.db, "ce-owner", tenant, campaign)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: draft })]));
  expect(await ids("ce-owner", second)).toEqual([]);
  const { rows: audit } = await f.admin.query("select action, metadata from audit_logs where tenant_id=$1 and action like 'campaign.event.%' order by created_at", [tenant]);
  expect(audit.map((row) => [row.action, row.metadata.eventId])).toEqual([["campaign.event.link", draft], ["campaign.event.link", published]]);
  const { rows: [stored] } = await f.admin.query("select status, version from events where id=$1", [draft]);
  expect(stored).toEqual({ status: "draft", version: 1 });
  // The dashboard figure and the checklist item become real.
  const overview = await getCampaignOverview(f.db, "ce-owner", tenant, campaign);
  expect(overview.events).toBe(2);
  expect(overview.unavailable).not.toContain("events");
  expect((await getChecklist(f.db, "ce-owner", tenant, campaign)).find((item) => item.item === "create_events")).toMatchObject({ done: true, automatic: true });
  expect((await getChecklist(f.db, "ce-owner", tenant, second)).find((item) => item.item === "create_events")).toMatchObject({ done: false, automatic: false });
  expect((await link("ce-owner", draft, false)).events.map((e) => e.id)).toEqual([published]);
});

it("shows campaign writers who do not manage Events only the published events Events already shows them", async () => {
  const hidden = await event(true), visible = await event(true), draft = await event(false);
  const mine = await campaignRow(tenant, "ce-owner", "Visibility");
  for (const id of [hidden, visible, draft]) await link("ce-owner", id, true, mine);
  await f.admin.query("insert into community_event_links(tenant_id,event_id,community_id) values ($1,$2,$3)", [tenant, visible, community]);
  expect(await ids("ce-member", mine)).toEqual([]);
  expect((await getCampaignOverview(f.db, "ce-member", tenant, mine)).events).toBe(0);
  expect((await getChecklist(f.db, "ce-member", tenant, mine)).find((item) => item.item === "create_events")?.automatic).toBe(false);
  await f.admin.query("insert into community_memberships (tenant_id,community_id,user_id,status) values ($1,$2,'ce-member','active')", [tenant, community]);
  await f.admin.query("insert into entitlements (tenant_id,id,user_id,resource_type,resource_id,source) values ($1,$2,'ce-member','community',$3,'admin_grant')", [tenant, randomUUID(), community]);
  expect(await ids("ce-member", mine)).toEqual([visible]);
  expect((await listCampaignEvents(f.db, "ce-member", tenant, mine))!.manage).toBe(false);
  expect(await ids("ce-campaigns", mine)).toEqual([]);
  expect((await ids("ce-owner", mine)).sort()).toEqual([hidden, visible, draft].sort());
});

it("refuses changes without Events manage, reads without campaign write, other ministries and unknown ids", async () => {
  const id = await event(true), foreignEvent = await event(true, "ce-other", () => other);
  for (const user of ["ce-member", "ce-campaigns"]) {
    expect(await status(link(user, id)), user).toBe(404);
    expect(await status(campaignEventCandidates(f.db, user, tenant, campaign)), user).toBe(404);
  }
  // Events managers who cannot write campaigns, viewers and outsiders never reach the campaign's events.
  for (const user of ["ce-events", "ce-viewer", "ce-other"]) {
    expect(await status(listCampaignEvents(f.db, user, tenant, campaign)), user).toBe(403);
    expect(await status(link(user, id)), user).toBe(403);
  }
  expect(await status(link("ce-owner", foreignEvent))).toBe(404);
  expect(await status(link("ce-owner", randomUUID()))).toBe(404);
  expect(await status(link("ce-owner", id, true, foreignCampaign))).toBe(404);
  expect(await status(link("ce-owner", id, true, randomUUID()))).toBe(404);
  expect(await status(setCampaignEvent(f.db, "ce-owner", tenant, campaign, { eventId: "nope", linked: true }))).toBe(500);
});

it("gives the app no direct access to the link table and drops links with the campaign or the event", async () => {
  for (const query of [sql`select * from campaign_event_links`, sql`insert into campaign_event_links (tenant_id, campaign_id, event_id) values (${tenant}, ${campaign}, ${randomUUID()})`])
    await expect(withTenant(f.db, "ce-owner", tenant, "workspace:read", (tx) => tx.execute(query))).rejects.toMatchObject({ cause: { code: "42501" } });
  // The definer refuses a tenant other than the caller's own session tenant.
  const crossed = await withTenant(f.db, "ce-owner", tenant, "campaigns:write", async (tx) =>
    (await tx.execute<{ r: { outcome: string } }>(sql`select public.campaign_events_operate(${other}::uuid, ${foreignCampaign}::uuid, 'list', null) r`)).rows[0].r);
  expect(crossed).toEqual({ outcome: "not_found" });
  const doomed = await campaignRow(tenant, "ce-owner", "Doomed"), id = await event(true);
  await link("ce-owner", id, true, doomed);
  await f.admin.query("delete from campaigns where id=$1", [doomed]);
  expect((await f.admin.query("select count(*)::int n from campaign_event_links where campaign_id=$1", [doomed])).rows[0].n).toBe(0);
  const rls = await f.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname='campaign_event_links'");
  expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});

it("reports events as unavailable and leaves the checklist manual while Events is off", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    const overview = await getCampaignOverview(f.db, "ce-owner", tenant, campaign);
    expect(overview).toMatchObject({ events: null });
    expect(overview.unavailable).toContain("events");
    expect(await listCampaignEvents(f.db, "ce-owner", tenant, campaign)).toBeNull();
    expect(await status(link("ce-owner", randomUUID()))).toBe(404);
  } finally { vi.stubEnv("NODE_ENV", "test"); }
});
