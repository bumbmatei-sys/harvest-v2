import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { auditLogs, campaignDraftAssignments, campaignDrafts, campaigns, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createDraft, discardDraft, finishDraft, getDraft, listDrafts, saveDraftStep, setCampaignStatus } from "../../src/server/campaign-wizard";
import { listCampaigns } from "../../src/server/campaigns";
import { defaultBudget, defaultOutreach } from "../../src/lib/campaign-wizard";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string;
const place = { country: "Thailand", cityRegion: "Bangkok", startDate: "2027-03-01", endDate: "2027-03-05", timeZone: "Asia/Bangkok", structure: "single" };
let n = 0;
const key = () => `k-${++n}`;
const draftFor = async (user: string, tenant = tenantA, type: string | null = "conference") => (await createDraft(fixture.db, user, tenant, { type }, key())).draft;
const save = (user: string, id: string, version: number, step: string, data: unknown, tenant = tenantA) => saveDraftStep(fixture.db, user, tenant, id, { version, step, data });
async function complete(user: string, id: string, version: number) {
  version = (await save(user, id, version, "basics", { name: "Synthetic conference", description: "Private notes" })).version;
  return (await save(user, id, version, "place", place)).version;
}
const status = async (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number; name?: string }) => error.status ?? (error.name === "ZodError" ? 400 : 500));

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "owner-b", "member-a", "member-a2", "admin-a", "viewer-a", "outsider"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Wizard A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Wizard B")).tenantId;
  for (const [user, role] of [["member-a", "member"], ["member-a2", "member"], ["admin-a", "admin"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${user}@example.test`, role);
});
afterAll(async () => { await fixture?.close(); });

describe("campaign wizard database shape", () => {
  it("forces RLS, grants no delete or whole-table update, and adds no SECURITY DEFINER function", async () => {
    const rls = await fixture.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('campaign_drafts','campaign_draft_assignments') order by relname");
    expect(rls.rows).toEqual([{ relname: "campaign_draft_assignments", relrowsecurity: true, relforcerowsecurity: true }, { relname: "campaign_drafts", relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = await fixture.admin.query(`select has_table_privilege('harvest_app','campaign_drafts','DELETE') as draft_delete, has_table_privilege('harvest_app','campaign_drafts','UPDATE') as draft_update,
      has_table_privilege('harvest_app','campaign_draft_assignments','UPDATE') as assignment_update, has_table_privilege('harvest_app','campaigns','UPDATE') as campaign_update,
      has_table_privilege('public','campaign_drafts','SELECT') as public_read`);
    expect(grants.rows).toEqual([{ draft_delete: false, draft_update: false, assignment_update: false, campaign_update: false, public_read: false }]);
    const columns = await fixture.admin.query("select column_name from information_schema.column_privileges where grantee='harvest_app' and table_name='campaigns' and privilege_type='UPDATE' order by 1");
    expect(columns.rows.map((r) => r.column_name)).toEqual(["status", "updated_at"]);
    expect((await fixture.admin.query("select count(*)::int as n from pg_proc where prosecdef and prosrc ilike '%campaign_draft%'")).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select distinct roles from pg_policies where tablename in ('campaign_drafts','campaign_draft_assignments')")).rows).toEqual([{ roles: "{harvest_app}" }]);
  });
  it("references no CRM contact, so erasing or merging a contact has nothing to re-key", async () => {
    const refs = await fixture.admin.query(`select conrelid::regclass::text as t, confrelid::regclass::text as target from pg_constraint
      where contype = 'f' and conrelid in ('campaign_drafts'::regclass, 'campaign_draft_assignments'::regclass) order by 1, 2`);
    expect(refs.rows.map((r) => r.target).sort()).toEqual(["campaigns", "campaign_drafts", "users", "workspace_members", "workspaces"].sort());
    const cols = await fixture.admin.query("select column_name from information_schema.columns where table_name in ('campaign_drafts','campaign_draft_assignments') and column_name ilike '%contact%'");
    expect(cols.rows).toEqual([]);
  });
});

describe("create and autosave", () => {
  it("creates idempotently, loads the type's template and writes a content-free audit row", async () => {
    const k = key();
    const first = await createDraft(fixture.db, "member-a", tenantA, { type: "evangelistic_crusade" }, k);
    const again = await createDraft(fixture.db, "member-a", tenantA, { type: "evangelistic_crusade" }, k);
    expect([first.created, again.created, again.draft.id]).toEqual([true, false, first.draft.id]);
    expect(first.draft).toMatchObject({ status: "draft", version: 1, createdBy: "member-a", currentStep: 2 });
    expect(first.draft.departments).toHaveLength(13);
    expect(first.draft.modules).toContain("qr_response_forms");
    expect(first.draft.issues.map((i) => i.code)).toContain("NAME_REQUIRED");
    // The same key from another person or ministry is a different draft.
    expect((await createDraft(fixture.db, "member-a2", tenantA, {}, k)).draft.id).not.toBe(first.draft.id);
    expect((await createDraft(fixture.db, "owner-b", tenantB, {}, k)).draft.id).not.toBe(first.draft.id);
    const audit = await fixture.admin.query("select actor_id, metadata from audit_logs where action='campaign.draft.create' and target_id=$1", [first.draft.id]);
    expect(audit.rows).toEqual([{ actor_id: "member-a", metadata: {} }]);
  });
  it("saves each step, bumps the version and keeps audit metadata free of content", async () => {
    const draft = await draftFor("member-a", tenantA, null);
    expect(draft.currentStep).toBe(1);
    let v = (await save("member-a", draft.id, 1, "type", { type: "local_outreach" })).version;
    expect(v).toBe(2);
    v = (await save("member-a", draft.id, v, "basics", { name: "Secret outreach name", description: "Sensitive description" })).version;
    v = (await save("member-a", draft.id, v, "place", place)).version;
    v = (await save("member-a", draft.id, v, "tools", { modules: ["tasks_boards", "qr_response_forms"] })).version;
    v = (await save("member-a", draft.id, v, "budget", { currency: "EUR", estimatedBudgetMinor: 150000, fundraisingEnabled: true, fundraisingGoalMinor: 90000, onlineDonations: true })).version;
    const last = await save("member-a", draft.id, v, "connect", { registration: false, qrResponse: true, accountInvites: true, communityDiscovery: false, followUp: true, churchReferrals: false });
    expect(last).toMatchObject({ version: 7, name: "Secret outreach name", country: "Thailand", structure: "single", modules: ["tasks_boards", "qr_response_forms"],
      budget: { currency: "EUR", onlineDonations: true }, outreach: { qrResponse: true, followUp: true }, currentStep: 8 });
    expect(last.issues.map((i) => i.code)).toEqual(["FUNDRAISING_MODULE_OFF"]);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).version).toBe(7);
    const audit = await fixture.admin.query("select metadata from audit_logs where action='campaign.draft.save' and target_id=$1 order by created_at", [draft.id]);
    expect(audit.rows).toHaveLength(6);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Secret|Sensitive|Thailand|EUR/);
    expect(audit.rows[0].metadata).toEqual({ step: "type", version: "2" });
  });
  it("rejects a stale version with 409 and changes nothing", async () => {
    const draft = await draftFor("member-a");
    await save("member-a", draft.id, 1, "basics", { name: "First" });
    expect(await status(save("member-a", draft.id, 1, "basics", { name: "Second" }))).toBe(409);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).name).toBe("First");
    const results = await Promise.allSettled([save("member-a", draft.id, 2, "basics", { name: "Race A" }), save("member-a", draft.id, 2, "basics", { name: "Race B" })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).version).toBe(3);
  });
  it("validates the shape and never saves an invalid step", async () => {
    const draft = await draftFor("member-a");
    for (const [step, data] of [["basics", { name: "" }], ["place", { startDate: "2027-03-05", endDate: "2027-03-01" }], ["review", {}], ["budget", { currency: "usd" }]] as const) {
      expect(await status(save("member-a", draft.id, 1, step, data))).toBe(400);
    }
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).version).toBe(1);
    // The database refuses what the service would not send.
    await expect(fixture.admin.query("update campaign_drafts set name = ' padded ' where id = $1", [draft.id])).rejects.toThrow();
  });
  it("changing the type reloads the template and removes people from dropped departments", async () => {
    const draft = await draftFor("member-a", tenantA, "evangelistic_crusade");
    let v = (await save("member-a", draft.id, 1, "leaders", { departments: ["campaign_leadership", "counseling"], assignments: [
      { userId: "member-a2", department: "counseling", role: "leader" }, { userId: "admin-a", department: "campaign_leadership", role: "leader" }] })).version;
    const changed = await save("member-a", draft.id, v, "type", { type: "local_outreach" });
    expect(changed.departments).toEqual(["campaign_leadership", "evangelistic_outreach", "prayer_intercession", "volunteers", "discipleship_follow_up"]);
    expect(changed.assignments.map((a) => a.department)).toEqual(["campaign_leadership"]);
    // Saving the same type again keeps the customised template.
    v = (await save("member-a", draft.id, changed.version, "tools", { modules: ["tasks_boards"] })).version;
    expect((await save("member-a", draft.id, v, "type", { type: "local_outreach" })).modules).toEqual(["tasks_boards"]);
  });
});

describe("leaders and teams", () => {
  it("only places ministry members who can edit, and replaces the whole set on each save", async () => {
    const draft = await draftFor("member-a");
    const departments = ["campaign_leadership", "volunteers"];
    for (const person of ["viewer-a", "outsider", "owner-b"]) {
      expect(await status(save("member-a", draft.id, 1, "leaders", { departments, assignments: [{ userId: person, department: "volunteers", role: "leader" }] }))).toBe(400);
    }
    const one = await save("member-a", draft.id, 1, "leaders", { departments, assignments: [{ userId: "admin-a", department: "volunteers", role: "leader" }, { userId: "member-a2", department: "volunteers", role: "member" }] });
    expect(one.assignments).toHaveLength(2);
    const two = await save("member-a", draft.id, one.version, "leaders", { departments, assignments: [{ userId: "owner-a", department: "campaign_leadership", role: "leader" }] });
    expect(two.assignments).toEqual([expect.objectContaining({ userId: "owner-a", department: "campaign_leadership", role: "leader" })]);
    expect(await status(save("member-a", draft.id, two.version, "leaders", { departments, assignments: [{ userId: "owner-a", department: "counseling", role: "leader" }] }))).toBe(400);
  });
  it("drops a person from every draft when they leave the ministry", async () => {
    const draft = await draftFor("member-a");
    await save("member-a", draft.id, 1, "leaders", { departments: ["volunteers"], assignments: [{ userId: "member-a2", department: "volunteers", role: "member" }] });
    await fixture.admin.query("insert into users (id,name,email) values ('leaver','l','leaver@example.test') on conflict do nothing");
    await fixture.admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'leaver','member') on conflict do nothing", [tenantA]);
    const withLeaver = await draftFor("member-a");
    await save("member-a", withLeaver.id, 1, "leaders", { departments: ["volunteers"], assignments: [{ userId: "leaver", department: "volunteers", role: "member" }] });
    await fixture.admin.query("delete from workspace_members where tenant_id=$1 and user_id='leaver'", [tenantA]);
    expect((await getDraft(fixture.db, "member-a", tenantA, withLeaver.id)).assignments).toEqual([]);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).assignments).toHaveLength(1);
  });
});

describe("roles and isolation", () => {
  it("lets a viewer read nothing and write nothing", async () => {
    expect(await status(createDraft(fixture.db, "viewer-a", tenantA, {}, key()))).toBe(403);
    expect((await listDrafts(fixture.db, "viewer-a", tenantA)).drafts).toEqual([]);
    const draft = await draftFor("member-a");
    expect(await status(getDraft(fixture.db, "viewer-a", tenantA, draft.id))).toBe(404);
  });
  it("keeps a draft private to its creator, with owners and admins able to read and discard only", async () => {
    const draft = await draftFor("member-a");
    expect(await status(getDraft(fixture.db, "member-a2", tenantA, draft.id))).toBe(404);
    expect((await listDrafts(fixture.db, "member-a2", tenantA)).drafts.some((d) => d.id === draft.id)).toBe(false);
    for (const admin of ["admin-a", "owner-a"]) {
      expect((await getDraft(fixture.db, admin, tenantA, draft.id)).id).toBe(draft.id);
      expect((await listDrafts(fixture.db, admin, tenantA)).drafts.some((d) => d.id === draft.id)).toBe(true);
      expect(await status(save(admin, draft.id, 1, "basics", { name: "Takeover" }))).toBe(403);
      expect(await status(finishDraft(fixture.db, admin, tenantA, draft.id, { version: 1 }))).toBe(403);
    }
    expect(await status(discardDraft(fixture.db, "member-a2", tenantA, draft.id, { version: 1 }))).toBe(404);
    expect((await discardDraft(fixture.db, "admin-a", tenantA, draft.id, { version: 1 })).status).toBe("discarded");
    expect((await discardDraft(fixture.db, "admin-a", tenantA, draft.id, { version: 1 })).status).toBe("discarded");
    expect(await status(save("member-a", draft.id, 2, "basics", { name: "Late" }))).toBe(409);
    expect((await fixture.admin.query("select actor_id from audit_logs where action='campaign.draft.discard' and target_id=$1", [draft.id])).rows).toEqual([{ actor_id: "admin-a" }]);
  });
  it("isolates ministries: no read, write, finish or discard across tenants, and a foreign id is simply not found", async () => {
    const draft = await draftFor("member-a");
    expect(await status(getDraft(fixture.db, "owner-b", tenantB, draft.id))).toBe(404);
    expect(await status(getDraft(fixture.db, "owner-b", tenantA, draft.id))).toBe(403);
    expect(await status(save("owner-b", draft.id, 1, "basics", { name: "Cross" }, tenantB))).toBe(404);
    expect(await status(finishDraft(fixture.db, "owner-b", tenantB, draft.id, { version: 1 }))).toBe(404);
    expect(await status(discardDraft(fixture.db, "owner-b", tenantB, draft.id, { version: 1 }))).toBe(404);
    expect((await listDrafts(fixture.db, "owner-b", tenantB)).drafts.some((d) => d.id === draft.id)).toBe(false);
    // Row security alone, with the service bypassed: a wrong tenant context sees nothing.
    await withUser(fixture.db, "owner-a", async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantB}, true)`);
      expect(await tx.select().from(campaignDrafts)).toEqual([]);
    });
  });
  it("refuses direct SQL that would skip the service rules", async () => {
    const draft = await draftFor("member-a");
    const attempt = (user: string, run: (tx: Parameters<Parameters<typeof withTenant>[4]>[0]) => Promise<unknown>) => withTenant(fixture.db, user, tenantA, "campaigns:read", run);
    const base = { tenantId: tenantA, createdBy: "member-a", clientKey: key(), budget: { ...defaultBudget }, outreach: { ...defaultOutreach } };
    await expect(attempt("member-a", (tx) => tx.insert(campaignDrafts).values({ ...base, status: "finished" }))).rejects.toThrow();
    await expect(attempt("member-a", (tx) => tx.insert(campaignDrafts).values({ ...base, createdBy: "member-a2" }))).rejects.toThrow();
    await expect(attempt("viewer-a", (tx) => tx.insert(campaignDrafts).values({ ...base, createdBy: "viewer-a" }))).rejects.toThrow();
    await expect(attempt("member-a", (tx) => tx.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    await expect(attempt("member-a", (tx) => tx.update(campaignDrafts).set({ createdBy: "member-a2" }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    await expect(attempt("member-a", (tx) => tx.update(campaignDrafts).set({ tenantId: tenantB }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    // An admin's update is refused unless it is a discard.
    await expect(attempt("admin-a", (tx) => tx.update(campaignDrafts).set({ name: "Sneaky" }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    await expect(attempt("admin-a", (tx) => tx.update(campaignDrafts).set({ status: "finished" }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    // Discarding must not carry other edits along with it.
    await expect(attempt("admin-a", (tx) => tx.update(campaignDrafts).set({ name: "Sneaky", status: "discarded" }).where(eq(campaignDrafts.id, draft.id)))).rejects.toMatchObject({ cause: { code: "42501" } });
    // The creator cannot mark a draft finished against some other campaign of the ministry.
    const other = await withTenant(fixture.db, "member-a", tenantA, "campaigns:write", (tx) => tx.insert(campaigns)
      .values({ tenantId: tenantA, ownerUserId: "member-a", name: "Other", type: "custom_project", idempotencyKey: key(), fingerprint: "d".repeat(64) }).returning({ id: campaigns.id }));
    await expect(attempt("member-a", (tx) => tx.update(campaignDrafts).set({ status: "finished", campaignId: other[0].id, finishedAt: new Date() }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    await expect(attempt("member-a2", (tx) => tx.insert(campaignDraftAssignments).values({ tenantId: tenantA, draftId: draft.id, userId: "member-a2", department: "volunteers", role: "member" }))).rejects.toThrow();
    expect(await attempt("member-a2", (tx) => tx.select().from(campaignDraftAssignments))).toEqual([]);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).name).toBeNull();
    // The admin's plain discard (status, version, timestamp only) still works.
    await attempt("admin-a", (tx) => tx.update(campaignDrafts).set({ status: "discarded", version: 2, updatedAt: new Date() }).where(eq(campaignDrafts.id, draft.id)));
    expect((await getDraft(fixture.db, "admin-a", tenantA, draft.id)).status).toBe("discarded");
  });
});

describe("finish and activate", () => {
  it("refuses an incomplete draft with the exact missing pieces", async () => {
    const draft = await draftFor("member-a");
    const error = await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version: 1 }).catch((e) => e);
    expect(error).toMatchObject({ status: 400, details: { issues: "basics:NAME_REQUIRED,place:STRUCTURE_REQUIRED,place:DATES_REQUIRED,place:TIME_ZONE_REQUIRED,place:COUNTRY_REQUIRED" } });
  });
  it("creates one unpublished campaign, once, however many times it is retried", async () => {
    const before = (await listCampaigns(fixture.db, "owner-a", tenantA)).total;
    const draft = await draftFor("member-a");
    const version = await complete("member-a", draft.id, 1);
    expect(await status(finishDraft(fixture.db, "member-a", tenantA, draft.id, { version: version - 1 }))).toBe(409);
    const [first, second] = [await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version }), await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version })];
    expect(second.campaignId).toBe(first.campaignId);
    expect(first.draft).toMatchObject({ status: "finished", campaignId: first.campaignId });
    expect((await listCampaigns(fixture.db, "owner-a", tenantA)).total).toBe(before + 1);
    const [row] = await fixture.admin.query("select owner_user_id, status, name, country, structure, idempotency_key from campaigns where id=$1", [first.campaignId]).then((r) => r.rows);
    expect(row).toEqual({ owner_user_id: "member-a", status: "draft", name: "Synthetic conference", country: "Thailand", structure: "single", idempotency_key: `wizard-${draft.id}` });
    // Nothing outward exists for the new campaign.
    for (const table of ["campaign_response_links", "campaign_responses", "outbox_events", "jobs"]) {
      const column = table === "outbox_events" || table === "jobs" ? "tenant_id" : "campaign_id";
      const count = column === "campaign_id" ? await fixture.admin.query(`select count(*)::int as n from ${table} where campaign_id=$1`, [first.campaignId]) : { rows: [{ n: 0 }] };
      expect(count.rows[0].n).toBe(0);
    }
    expect(await status(save("member-a", draft.id, version + 1, "basics", { name: "After finish" }))).toBe(409);
    expect((await fixture.admin.query("select action from audit_logs where target_id=$1 order by created_at, action", [draft.id])).rows.map((r) => r.action)).toContain("campaign.draft.finish");
    expect((await fixture.admin.query("select count(*)::int as n from audit_logs where action='campaign.create' and target_id=$1", [first.campaignId])).rows[0].n).toBe(1);
  });
  it("starts the creator as owner and gives a discarded draft no campaign", async () => {
    const draft = await draftFor("member-a2");
    const version = await complete("member-a2", draft.id, 1);
    await discardDraft(fixture.db, "member-a2", tenantA, draft.id, { version });
    expect(await status(finishDraft(fixture.db, "member-a2", tenantA, draft.id, { version }))).toBe(409);
  });
  it("activates and deactivates as state only, for owners and admins, once the place is set", async () => {
    const draft = await draftFor("member-a");
    const version = await complete("member-a", draft.id, 1);
    const { campaignId } = await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version });
    for (const user of ["member-a", "viewer-a"]) expect(await status(setCampaignStatus(fixture.db, user, tenantA, campaignId, { status: "active" }))).toBe(403);
    expect(await status(setCampaignStatus(fixture.db, "owner-b", tenantB, campaignId, { status: "active" }))).toBe(404);
    expect(await setCampaignStatus(fixture.db, "admin-a", tenantA, campaignId, { status: "active" })).toEqual({ id: campaignId, status: "active" });
    expect(await setCampaignStatus(fixture.db, "admin-a", tenantA, campaignId, { status: "active" })).toEqual({ id: campaignId, status: "active" });
    expect(await setCampaignStatus(fixture.db, "owner-a", tenantA, campaignId, { status: "draft" })).toEqual({ id: campaignId, status: "draft" });
    expect((await fixture.admin.query("select action, actor_id from audit_logs where target_id=$1 and action in ('campaign.activate','campaign.deactivate') order by created_at", [campaignId])).rows)
      .toEqual([{ action: "campaign.activate", actor_id: "admin-a" }, { action: "campaign.deactivate", actor_id: "owner-a" }]);
    expect((await fixture.admin.query("select count(*)::int as n from campaign_response_links where campaign_id=$1", [campaignId])).rows[0].n).toBe(0);
  });
  it("will not activate a campaign without place, dates and time zone, or one that is archived", async () => {
    const bare = await withTenant(fixture.db, "member-a", tenantA, "campaigns:write", (tx) => tx.insert(campaigns)
      .values({ tenantId: tenantA, ownerUserId: "member-a", name: "Bare", type: "custom_project", idempotencyKey: key(), fingerprint: "c".repeat(64) }).returning({ id: campaigns.id }));
    expect(await setCampaignStatus(fixture.db, "admin-a", tenantA, bare[0].id, { status: "active" }).catch((e) => e)).toMatchObject({ status: 409, details: { issues: "STRUCTURE_REQUIRED,DATES_REQUIRED,TIME_ZONE_REQUIRED,COUNTRY_REQUIRED" } });
    await fixture.admin.query("update campaigns set archived_at = now() where id=$1", [bare[0].id]);
    expect(await status(setCampaignStatus(fixture.db, "admin-a", tenantA, bare[0].id, { status: "draft" }))).toBe(404);
  });
  it("lets the runtime role change nothing on a campaign except its status", async () => {
    const [{ id }] = await fixture.admin.query("select id from campaigns where tenant_id=$1 and status='draft' and archived_at is null limit 1", [tenantA]).then((r) => r.rows);
    const run = (user: string, set: Record<string, unknown>) => withTenant(fixture.db, user, tenantA, "campaigns:read", (tx) => tx.update(campaigns).set(set).where(eq(campaigns.id, id)).returning({ id: campaigns.id }));
    await expect(run("admin-a", { name: "Rename" })).rejects.toThrow();
    await expect(run("admin-a", { status: "archived" })).rejects.toThrow();
    expect(await run("member-a", { status: "active" })).toEqual([]);
    expect(await run("viewer-a", { status: "active" })).toEqual([]);
  });
  it("keeps campaign list and audit rows free of draft-only settings", async () => {
    const audits = await fixture.db.select({ metadata: auditLogs.metadata, action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.tenantId, tenantA));
    expect(JSON.stringify(audits.filter((a) => a.action.startsWith("campaign.")))).not.toMatch(/Synthetic|Private notes|Bangkok|EUR/);
  });
});
