import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { users } from "../../src/db/schema";
import { createContact, recordConsent } from "../../src/server/contacts";
import { newsletterAnalyticsOverview, newsletterCampaignAnalytics } from "../../src/server/newsletter-campaigns/analytics-overview";
import { createWorkspace } from "../../src/server/workspaces";
import { periodRange } from "../../src/lib/newsletter-analytics";
import { testDatabase } from "../database";
import { seedCampaign } from "../helpers/newsletter-analytics-seed";

const owner = "ana-owner", admin = "ana-admin", member = "ana-member", viewer = "ana-viewer", other = "ana-other";
const now = new Date("2026-11-24T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, elsewhere: string, client: PoolClient;
const overview = (user: string, workspace: string, period: 7 | 30 | 90 = 30) => newsletterAnalyticsOverview(fixture.db, user, workspace, period, now);

beforeAll(async () => {
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([randomBytes(32).toString("hex")]));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, admin, member, viewer, other].map((id) => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(fixture.db, owner, "Analytics ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, other, "Other ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin'),($1,$3,'member'),($1,$4,'viewer')", [tenant, admin, member, viewer]);
  client = await fixture.admin.connect();
}, 60_000);
afterAll(async () => { client?.release(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await fixture?.close(); });

it("is quiet and honest before anything is sent", async () => {
  const report = await overview(owner, tenant);
  expect(report).toMatchObject({ period: 30, totals: { sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 }, campaigns: [], campaignsTruncated: false });
  expect(report.days).toHaveLength(30);
  expect(report.range).toEqual(periodRange(30, now));
  expect(report.days.every((day) => day.counts?.sent === 0)).toBe(true);
});

it("reports totals, a daily series and per-campaign figures for the period, in UTC", async () => {
  const first = await seedCampaign(client, { tenant, user: owner, name: "Advent letter", days: [
    { day: daysAgo(3), accepted: 20, delivered: 18, bounced: 2, complained: 0, unsubscribed: 5 }, { day: daysAgo(2), accepted: 10, delivered: 10 }] });
  await seedCampaign(client, { tenant, user: owner, name: "Old letter", days: [{ day: daysAgo(60), accepted: 30, delivered: 30 }] });
  const week = await overview(owner, tenant, 7);
  expect(week.totals).toEqual({ sent: 30, delivered: 28, bounced: 2, complained: 0, unsubscribed: 5 });
  expect(week.days).toHaveLength(7);
  expect(week.days.find((day) => day.day === daysAgo(3))?.counts).toMatchObject({ sent: 20, delivered: 18, bounced: 2, unsubscribed: 5 });
  expect(week.days.find((day) => day.day === daysAgo(1))?.counts?.sent).toBe(0);
  expect(week.campaigns).toEqual([{ id: first, name: "Advent letter", state: "sent", counts: { sent: 30, delivered: 28, bounced: 2, complained: 0, unsubscribed: 5 } }]);
  const quarter = await overview(admin, tenant, 90);
  expect(quarter.totals).toMatchObject({ sent: 60, delivered: 58 });
  expect(quarter.campaigns.map((row) => row.name).sort()).toEqual(["Advent letter", "Old letter"]);
  expect(quarter.days).toHaveLength(90);
  // The 30 day window leaves the 60 day old send out.
  expect((await overview(owner, tenant, 30)).totals?.sent).toBe(30);
});

it("withholds groups of fewer than 5 everywhere and never lists a person", async () => {
  const tiny = await seedCampaign(client, { tenant, user: owner, name: "Tiny letter", days: [{ day: daysAgo(1), accepted: 3, delivered: 3, skipped: 0 }] });
  const week = await overview(owner, tenant, 7);
  expect(week.totals).toBeNull();
  expect(week.days.find((day) => day.day === daysAgo(1))?.counts).toBeNull();
  expect(week.campaigns.find((row) => row.id === tiny)?.counts).toBeNull();
  // The other days of the same window still carry their own figures.
  expect(week.days.find((day) => day.day === daysAgo(3))?.counts?.sent).toBe(20);
  expect(JSON.stringify(week)).not.toMatch(/@|subscriber|address/i);
});

it("applies the small-group rule to the audience counts and respects do not contact", async () => {
  const people = [] as string[];
  for (let index = 0; index < 5; index++) people.push((await createContact(fixture.db, owner, tenant, { name: `Person ${index}`, email: `p${index}@example.test`, notes: "" })).id);
  const grant = (id: string, status: "granted" | "withdrawn") => recordConsent(fixture.db, owner, tenant, id, { purpose: "newsletter", status, channel: "email", noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" });
  await grant(people[0], "withdrawn"); await grant(people[1], "withdrawn");
  const hidden = await overview(owner, tenant);
  // Two withdrawals (do not contact) are a group of 1 to 4: withheld. Nobody is subscribed to a list: zero is shown.
  expect(hidden.audience).toEqual({ subscribed: 0, unsubscribed: null, suppressed: 0 });
  for (const id of people.slice(2)) await grant(id, "withdrawn");
  expect((await overview(owner, tenant)).audience.unsubscribed).toBe(5);
});

it("limits analytics to owners and admins and keeps ministries apart", async () => {
  for (const user of [member, viewer]) await expect(overview(user, tenant)).rejects.toMatchObject({ status: 404 });
  await expect(overview(other, tenant)).rejects.toMatchObject({ status: 404 });
  await expect(overview(owner, elsewhere)).rejects.toMatchObject({ status: 404 });
  const own = await overview(other, elsewhere);
  expect(own.totals).toMatchObject({ sent: 0 });
  expect(own.campaigns).toEqual([]);
  await expect(overview(owner, "not-a-uuid")).rejects.toBeTruthy();
});

it("reports one campaign: totals, a series since send, the status breakdown, and honest states for unsent and small campaigns", async () => {
  const sent = await seedCampaign(client, { tenant, user: owner, name: "Detail letter", days: [{ day: daysAgo(4), accepted: 12, delivered: 10, bounced: 1, skipped: 6 }, { day: daysAgo(2), accepted: 8, delivered: 8 }] });
  const report = await newsletterCampaignAnalytics(fixture.db, admin, tenant, sent, now);
  expect(report).toMatchObject({ sent: true, campaign: { id: sent, name: "Detail letter", state: "sent" }, totals: { sent: 20, delivered: 18, bounced: 1 },
    status: { selected: 26, skipped: 6, accepted: 20, delivered: 18 } });
  expect(report.days[0].day).toBe(daysAgo(6)); // at least a week, from the first day with records
  expect(report.days.at(-1)?.day).toBe(daysAgo(0));
  expect(report.days.find((day) => day.day === daysAgo(3))?.counts?.sent).toBe(0);
  const tiny = await seedCampaign(client, { tenant, user: owner, name: "Tiny detail", days: [{ day: daysAgo(2), accepted: 2, delivered: 2 }] });
  expect(await newsletterCampaignAnalytics(fixture.db, owner, tenant, tiny, now)).toMatchObject({ sent: true, totals: null, status: null });
  const draft = randomUUID();
  await client.query("set session_replication_role = replica");
  await client.query("insert into newsletter_campaigns(tenant_id,id,name,created_by,state) values($1,$2,'Draft one',$3,'draft')", [tenant, draft, owner]);
  await client.query("set session_replication_role = origin");
  expect(await newsletterCampaignAnalytics(fixture.db, owner, tenant, draft, now)).toMatchObject({ sent: false, totals: null, days: [], status: null });
  for (const user of [member, viewer, other]) await expect(newsletterCampaignAnalytics(fixture.db, user, tenant, sent, now)).rejects.toMatchObject({ status: 404 });
  await expect(newsletterCampaignAnalytics(fixture.db, other, elsewhere, sent, now)).rejects.toMatchObject({ status: 404 });
  await expect(newsletterCampaignAnalytics(fixture.db, owner, tenant, "not-a-uuid", now)).rejects.toMatchObject({ status: 404 });
});
