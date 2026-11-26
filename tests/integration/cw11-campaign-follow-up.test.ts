import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { hc13Fixture } from "./hc13-fixture";
import { withTenant } from "../../src/server/tenancy";
import { assignFollowUpCase, campaignFollowUpCounts, campaignFollowUpTeam, listFollowUpCases, setCampaignFollowUpTeamMember,
  transitionFollowUpCase } from "../../src/server/follow-up-cases";

// CW-11: per-campaign follow-up list, counts and team. campaign_id stays unreadable to the app; these go through owner/admin definers.
vi.mock("server-only", () => ({}));
let ctx: Awaited<ReturnType<typeof hc13Fixture>>;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number }) => error.status ?? 500);
const asApp = (user: string, query: ReturnType<typeof sql>) => withTenant(ctx.f.db, user, ctx.tenantA, "workspace:read", (tx) => tx.execute(query));

beforeAll(async () => { ctx = await hc13Fixture(); });
afterAll(async () => { await ctx?.f.close(); });

describe("per-campaign follow-up", () => {
  it("lists only that campaign's cases, with the same fields as the ministry list and keyset paging", async () => {
    const first = await ctx.seedCase(), second = await ctx.seedCase(), third = await ctx.seedCase();
    const all = await listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { campaignId: ctx.campaign, limit: 200 });
    expect(all.items.map((item) => item.id)).toEqual(expect.arrayContaining([first.caseId, second.caseId, third.caseId]));
    expect(Object.keys(all.items[0]).sort()).toEqual(["assignedAt", "assigneeId", "contactId", "createdAt", "id", "state", "stateChangedAt", "updatedAt", "version"]);
    expect(all.items[0].createdAt).toBeInstanceOf(Date);
    expect((await listFollowUpCases(ctx.f.db, "d-admin", ctx.tenantA, { campaignId: ctx.emptyCampaign })).items).toEqual([]);
    // Pages of one: every case exactly once, oldest first.
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { campaignId: ctx.campaign, limit: 1, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(all.items.map((item) => item.id));
    expect((await listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { campaignId: ctx.campaign, state: "connected" })).items).toEqual([]);
  });

  it("counts by dashboard group without names", async () => {
    const before = await campaignFollowUpCounts(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign);
    const seeded = await ctx.seedCase();
    await transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId, { to: "awaiting_assignment", version: 1 });
    await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId, { assigneeId: "d-member", version: 2 });
    const after = await campaignFollowUpCounts(ctx.f.db, "d-admin", ctx.tenantA, ctx.campaign);
    expect(after).toEqual({ ...before, assigned: before.assigned + 1 });
    expect(Object.keys(after).sort()).toEqual(["assigned", "closed", "connected", "waiting"]);
    expect(await campaignFollowUpCounts(ctx.f.db, "d-owner", ctx.tenantA, ctx.emptyCampaign)).toEqual({ waiting: 0, assigned: 0, connected: 0, closed: 0 });
  });

  it("keeps a campaign team of active owners, admins and members, idempotent and audited", async () => {
    expect(await setCampaignFollowUpTeamMember(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign, { userId: "d-member", member: true })).toEqual({ changed: true });
    expect(await setCampaignFollowUpTeamMember(ctx.f.db, "d-admin", ctx.tenantA, ctx.campaign, { userId: "d-member", member: true })).toEqual({ changed: false });
    await setCampaignFollowUpTeamMember(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign, { userId: "d-admin2", member: true });
    expect(await campaignFollowUpTeam(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign)).toEqual(["d-member", "d-admin2"]);
    expect(await campaignFollowUpTeam(ctx.f.db, "d-owner", ctx.tenantA, ctx.emptyCampaign)).toEqual([]);
    // A viewer, a stranger and another ministry's member can never be added.
    for (const userId of ["d-viewer", "d-stranger", "d-other"]) {
      expect(await status(setCampaignFollowUpTeamMember(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign, { userId, member: true }))).toBe(400);
    }
    expect(await setCampaignFollowUpTeamMember(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign, { userId: "d-admin2", member: false })).toEqual({ changed: true });
    expect(await campaignFollowUpTeam(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign)).toEqual(["d-member"]);
    const { rows } = await ctx.f.admin.query("select action, metadata from audit_logs where tenant_id = $1 and action like 'followup.campaign_team.%' order by created_at", [ctx.tenantA]);
    expect(rows.map((row) => [row.action, row.metadata.member])).toEqual([["followup.campaign_team.add", "d-member"], ["followup.campaign_team.add", "d-admin2"], ["followup.campaign_team.remove", "d-admin2"]]);
  });

  it("refuses members, viewers, outsiders, another ministry and unknown campaigns", async () => {
    for (const user of ["d-member", "d-viewer", "d-stranger", "d-other"]) {
      expect(await status(listFollowUpCases(ctx.f.db, user, ctx.tenantA, { campaignId: ctx.campaign })), user).toBe(403);
      expect(await status(campaignFollowUpCounts(ctx.f.db, user, ctx.tenantA, ctx.campaign)), user).toBe(403);
      expect(await status(campaignFollowUpTeam(ctx.f.db, user, ctx.tenantA, ctx.campaign)), user).toBe(403);
      expect(await status(setCampaignFollowUpTeamMember(ctx.f.db, user, ctx.tenantA, ctx.campaign, { userId: "d-member", member: true })), user).toBe(403);
    }
    expect(await status(campaignFollowUpCounts(ctx.f.db, "d-owner", ctx.tenantA, randomUUID()))).toBe(404);
    await expect(campaignFollowUpTeam(ctx.f.db, "d-owner", ctx.tenantA, randomUUID())).rejects.toMatchObject({ status: 404, details: { reason: "campaign_not_found" } });
    // Another ministry's campaign id is unknown here.
    expect(await status(campaignFollowUpCounts(ctx.f.db, "d-other", ctx.tenantB, ctx.campaign))).toBe(404);
  });

  it("gives the app no direct access to the team table and still hides campaign ids on cases", async () => {
    for (const query of [sql`select * from campaign_followup_team`, sql`insert into campaign_followup_team (tenant_id, campaign_id, user_id, added_by) values (${ctx.tenantA}, ${ctx.campaign}, 'd-member', 'd-owner')`,
      sql`select campaign_id from followup_cases`]) {
      await expect(asApp("d-owner", query)).rejects.toMatchObject({ cause: { code: "42501" } });
    }
    expect((await ctx.f.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'campaign_followup_team'")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
