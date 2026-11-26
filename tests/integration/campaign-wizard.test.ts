import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { auditLogs, campaignChecklistItems, campaignDraftAssignments, campaignDrafts, campaignFiles, campaigns, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createDraft, discardDraft, finishDraft, getDraft, listDrafts, saveDraftStep, setCampaignStatus } from "../../src/server/campaign-wizard";
import { listCampaigns } from "../../src/server/campaigns";
import { acceptInvitation, inviteToDraft, revokeInvitation, type InvitationMail } from "../../src/server/campaign-wizard-invitations";
import { confirmDraftCoverUpload, createDraftCoverUpload, getCampaignCoverUrl, getDraftCoverUrl, setDraftCover } from "../../src/server/campaign-wizard-cover";
import { getCampaignOverview } from "../../src/server/campaign-overview";
import { getChecklist, setChecklistItem } from "../../src/server/campaign-checklist";
import { defaultBudget, defaultOutreach } from "../../src/lib/campaign-wizard";

vi.mock("server-only", () => ({}));
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
/** Invites and keeps the link the sink saw, which is the only place the token exists. */
async function invite(user: string, draftId: string, input: unknown, tenant = tenantA) {
  let mail: InvitationMail | undefined;
  const sent = await inviteToDraft(fixture.db, user, tenant, draftId, input, async (m) => { mail = m; });
  return { id: sent.id, mail: mail as InvitationMail, token: (mail as InvitationMail).url.split("/").pop() as string };
}
const status = async (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number; name?: string }) => error.status ?? (error.name === "ZodError" ? 400 : 500));

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "owner-b", "member-a", "member-a2", "admin-a", "viewer-a", "outsider", "temp-a"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Wizard A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Wizard B")).tenantId;
  for (const [user, role] of [["member-a", "member"], ["member-a2", "member"], ["admin-a", "admin"], ["viewer-a", "viewer"], ["temp-a", "member"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${user}@example.test`, role);
});
afterAll(async () => { await fixture?.close(); });

describe("campaign wizard database shape", () => {
  it("forces RLS, grants no delete or whole-table update, and has one SECURITY DEFINER function (accepting an invitation)", async () => {
    const rls = await fixture.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('campaign_drafts','campaign_draft_assignments','campaign_files','campaign_draft_invitations') order by relname");
    expect(rls.rows).toEqual([{ relname: "campaign_draft_assignments", relrowsecurity: true, relforcerowsecurity: true }, { relname: "campaign_draft_invitations", relrowsecurity: true, relforcerowsecurity: true }, { relname: "campaign_drafts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "campaign_files", relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = await fixture.admin.query(`select has_table_privilege('harvest_app','campaign_drafts','DELETE') as draft_delete, has_table_privilege('harvest_app','campaign_drafts','UPDATE') as draft_update,
      has_table_privilege('harvest_app','campaign_draft_assignments','UPDATE') as assignment_update, has_table_privilege('harvest_app','campaigns','UPDATE') as campaign_update,
      has_table_privilege('public','campaign_drafts','SELECT') as public_read`);
    expect(grants.rows).toEqual([{ draft_delete: false, draft_update: false, assignment_update: false, campaign_update: false, public_read: false }]);
    const columns = await fixture.admin.query("select column_name from information_schema.column_privileges where grantee='harvest_app' and table_name='campaigns' and privilege_type='UPDATE' order by 1");
    expect(columns.rows.map((r) => r.column_name)).toEqual(["status", "updated_at"]);
    expect((await fixture.admin.query("select has_table_privilege('harvest_app','campaign_files','DELETE') as d, has_table_privilege('harvest_app','campaign_files','UPDATE') as u, has_table_privilege('public','campaign_files','SELECT') as p")).rows)
      .toEqual([{ d: false, u: false, p: false }]);
    expect((await fixture.admin.query("select column_name from information_schema.column_privileges where grantee='harvest_app' and table_name='campaign_files' and privilege_type='UPDATE' order by 1")).rows.map((r) => r.column_name)).toEqual(["retired_at", "status"]);
    expect((await fixture.admin.query("select proname, proconfig, has_function_privilege('harvest_app', oid, 'EXECUTE') as app, has_function_privilege('public', oid, 'EXECUTE') as pub from pg_proc where prosecdef and (prosrc ilike '%campaign_draft%' or prosrc ilike '%campaign_files%')")).rows)
      .toEqual([{ proname: "campaign_invitation_accept", proconfig: ["search_path=pg_catalog, pg_temp"], app: true, pub: false }]);
    expect((await fixture.admin.query("select distinct roles from pg_policies where tablename in ('campaign_drafts','campaign_draft_assignments','campaign_files','campaign_draft_invitations') order by 1")).rows).toEqual([{ roles: "{harvest_app}" }, { roles: "{public}" }]);
  });
  it("references no CRM contact, so erasing or merging a contact has nothing to re-key", async () => {
    const refs = await fixture.admin.query(`select conrelid::regclass::text as t, confrelid::regclass::text as target from pg_constraint
      where contype = 'f' and conrelid in ('campaign_drafts'::regclass, 'campaign_draft_assignments'::regclass) order by 1, 2`);
    expect(refs.rows.map((r) => r.target).sort()).toEqual(["campaigns", "campaign_drafts", "campaign_files", "users", "workspace_members", "workspaces"].sort());
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
  it("changing the type reloads the template and keeps the customised one when the type is saved again", async () => {
    const draft = await draftFor("member-a", tenantA, "evangelistic_crusade");
    let v = (await save("member-a", draft.id, 1, "leaders", { departments: ["campaign_leadership", "counseling"] })).version;
    const changed = await save("member-a", draft.id, v, "type", { type: "local_outreach" });
    expect(changed.departments).toEqual(["campaign_leadership", "evangelistic_outreach", "prayer_intercession", "volunteers", "discipleship_follow_up"]);
    // Saving the same type again keeps the customised template.
    v = (await save("member-a", draft.id, changed.version, "tools", { modules: ["tasks_boards"] })).version;
    expect((await save("member-a", draft.id, v, "type", { type: "local_outreach" })).modules).toEqual(["tasks_boards"]);
  });
});

describe("teams: departments and invitations", () => {
  it("places a person in a department only after they accept, for a member picked or an email that is a member's", async () => {
    const draft = await draftFor("member-a");
    const departments = ["campaign_leadership", "volunteers"];
    await save("member-a", draft.id, 1, "leaders", { departments });
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).assignments).toEqual([]);
    const byPick = await invite("member-a", draft.id, { department: "volunteers", role: "leader", userId: "admin-a" });
    const byEmail = await invite("member-a", draft.id, { department: "volunteers", role: "member", email: " Member-A2@Example.test " });
    expect(byPick.mail).toMatchObject({ to: "admin-a@example.test", kind: "member" });
    expect(byEmail.mail).toMatchObject({ to: "member-a2@example.test", kind: "member" }); // a member's email invites that member
    const pending = (await getDraft(fixture.db, "member-a", tenantA, draft.id)).invitations;
    expect(pending.map((i) => [i.label, i.state, i.kind]).sort()).toEqual([["admin-a", "pending", "member"], ["member-a2", "pending", "member"]]);
    expect(JSON.stringify(pending)).not.toContain(byPick.token);
    expect(await status(invite("member-a", draft.id, { department: "volunteers", role: "leader", userId: "admin-a" }))).toBe(409); // already invited
    // Someone else's link does nothing; the invited member accepts and is placed.
    expect(await status(acceptInvitation(fixture.db, "member-a2", { token: byPick.token }))).toBe(404);
    expect(await acceptInvitation(fixture.db, "admin-a", { token: byPick.token })).toMatchObject({ tenantId: tenantA, draftId: draft.id, department: "volunteers", role: "leader", joined: false });
    expect((await acceptInvitation(fixture.db, "admin-a", { token: byPick.token })).joined).toBe(false); // repeating is harmless
    const after = await getDraft(fixture.db, "owner-a", tenantA, draft.id);
    expect(after.assignments).toEqual([expect.objectContaining({ userId: "admin-a", department: "volunteers", role: "leader" })]);
    expect(after.invitations.find((i) => i.label === "admin-a")).toMatchObject({ state: "accepted", acceptedBy: "admin-a" });
    expect(await status(invite("member-a", draft.id, { department: "volunteers", role: "member", userId: "admin-a" }))).toBe(409); // already placed
    // Viewers and unknown ids cannot be picked; a department not on the draft cannot be used.
    expect(await status(invite("member-a", draft.id, { department: "volunteers", role: "member", userId: "viewer-a" }))).toBe(400);
    expect(await status(invite("member-a", draft.id, { department: "volunteers", role: "member", userId: "owner-b" }))).toBe(400);
    expect(await status(invite("member-a", draft.id, { department: "counseling", role: "member", email: "x@example.test" }))).toBe(400);
    expect(await status(invite("viewer-a", draft.id, { department: "volunteers", role: "member", email: "x@example.test" }))).toBe(403);
    // Revoking withdraws a pending one; a revoked link no longer works.
    await revokeInvitation(fixture.db, "member-a2", tenantA, draft.id, byEmail.id);
    expect(await status(acceptInvitation(fixture.db, "member-a2", { token: byEmail.token }))).toBe(409);
    expect(await status(revokeInvitation(fixture.db, "member-a2", tenantA, draft.id, byEmail.id))).toBe(404);
  });
  it("invites an email that is not a member: accepting adds the person to the ministry with no permission anywhere, and places them", async () => {
    const draft = await draftFor("member-a");
    await save("member-a", draft.id, 1, "leaders", { departments: ["volunteers"] });
    const fresh = "guest-a@example.test";
    await fixture.db.insert(users).values({ id: "guest-a", name: "Guest A", email: fresh }).onConflictDoNothing();
    const sent = await invite("member-a", draft.id, { department: "volunteers", role: "member", email: fresh });
    expect(sent.mail).toMatchObject({ to: fresh, kind: "email" });
    expect(await status(acceptInvitation(fixture.db, "member-a2", { token: sent.token }))).toBe(404); // another account
    expect((await fixture.admin.query("select 1 from workspace_members where tenant_id=$1 and user_id='guest-a'", [tenantA])).rowCount).toBe(0);
    expect(await acceptInvitation(fixture.db, "guest-a", { token: sent.token })).toMatchObject({ department: "volunteers", role: "member", joined: true });
    expect((await fixture.admin.query("select role_id from workspace_members where tenant_id=$1 and user_id='guest-a'", [tenantA])).rows).toEqual([{ role_id: "campaign_guest" }]);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).assignments).toEqual([expect.objectContaining({ userId: "guest-a", department: "volunteers" })]);
    // The guest holds no permission: no draft, no campaigns, no ministry data.
    expect(await status(getDraft(fixture.db, "guest-a", tenantA, draft.id))).toBe(403);
    expect(await status(listDrafts(fixture.db, "guest-a", tenantA))).toBe(403);
    expect(await status(createDraft(fixture.db, "guest-a", tenantA, {}, key()))).toBe(403);
    expect((await fixture.admin.query("select action from audit_logs where action='campaign.invitation.accept' and actor_id='guest-a'")).rowCount).toBe(1);
  });
  it("lets a link expire after 14 days, and refuses one for a discarded draft", async () => {
    const draft = await draftFor("member-a");
    await save("member-a", draft.id, 1, "leaders", { departments: ["volunteers", "counseling"] });
    const old = await invite("member-a", draft.id, { department: "volunteers", role: "member", userId: "member-a2" });
    const row = (await fixture.admin.query("select created_at, expires_at from campaign_draft_invitations where id=$1", [old.id])).rows[0];
    expect(new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()).toBe(14 * 86_400_000);
    await fixture.admin.query("update campaign_draft_invitations set created_at = created_at - interval '15 days', expires_at = expires_at - interval '15 days' where id=$1", [old.id]);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).invitations[0].state).toBe("expired");
    expect(await status(acceptInvitation(fixture.db, "member-a2", { token: old.token }))).toBe(409);
    expect((await fixture.admin.query("select count(*)::int as n from campaign_draft_assignments where draft_id=$1", [draft.id])).rows[0].n).toBe(0);
    // An expired invitation is still pending in the table until it is withdrawn, so a second one to the same person is refused until then.
    expect(await status(invite("member-a", draft.id, { department: "volunteers", role: "member", userId: "member-a2" }))).toBe(409);
    await revokeInvitation(fixture.db, "member-a", tenantA, draft.id, old.id).catch(() => undefined);
    const other = await invite("member-a", draft.id, { department: "counseling", role: "member", userId: "member-a2" });
    const version = (await getDraft(fixture.db, "member-a", tenantA, draft.id)).version;
    await discardDraft(fixture.db, "member-a", tenantA, draft.id, { version });
    expect(await status(acceptInvitation(fixture.db, "member-a2", { token: other.token }))).toBe(409);
    expect(await status(invite("member-a", draft.id, { department: "counseling", role: "member", userId: "admin-a" }))).toBe(409);
  });
  it("removes pending invitations and people with a department that leaves the draft", async () => {
    const draft = await draftFor("member-a", tenantA, "evangelistic_crusade");
    const placed = await invite("member-a", draft.id, { department: "counseling", role: "leader", userId: "member-a2" });
    const waiting = await invite("member-a", draft.id, { department: "counseling", role: "member", email: "waiting@example.test" });
    await acceptInvitation(fixture.db, "member-a2", { token: placed.token });
    const kept = await invite("member-a", draft.id, { department: "campaign_leadership", role: "leader", userId: "admin-a" });
    const v = (await save("member-a", draft.id, 1, "leaders", { departments: ["campaign_leadership"] })).version;
    const view = await getDraft(fixture.db, "member-a", tenantA, draft.id);
    expect(view.assignments).toEqual([]);
    expect(Object.fromEntries(view.invitations.map((i) => [i.id, i.state]))).toEqual({ [placed.id]: "accepted", [waiting.id]: "revoked", [kept.id]: "pending" });
    expect(await status(acceptInvitation(fixture.db, "admin-a", { token: waiting.token }))).toBe(404);
    // A different type reloads the template: departments it drops lose their pending invitations too.
    const changed = await save("member-a", draft.id, v, "type", { type: "custom_project" });
    expect(changed.departments).toEqual(["campaign_leadership"]);
    expect(changed.invitations.find((i) => i.id === kept.id)?.state).toBe("pending");
    expect(await status(acceptInvitation(fixture.db, "admin-a", { token: kept.token }))).toBe(200);
  });
});

describe("roles and isolation", () => {
  it("lets a viewer read nothing and write nothing", async () => {
    expect(await status(createDraft(fixture.db, "viewer-a", tenantA, {}, key()))).toBe(403);
    expect((await listDrafts(fixture.db, "viewer-a", tenantA)).drafts).toEqual([]);
    const draft = await draftFor("member-a");
    expect(await status(getDraft(fixture.db, "viewer-a", tenantA, draft.id))).toBe(404);
  });
  it("shares an open draft with everyone who can write campaigns; only the creator, owners and admins discard it", async () => {
    const draft = await draftFor("member-a");
    for (const person of ["member-a2", "admin-a", "owner-a"]) {
      expect((await getDraft(fixture.db, person, tenantA, draft.id)).id).toBe(draft.id);
      expect((await listDrafts(fixture.db, person, tenantA)).drafts.some((d) => d.id === draft.id)).toBe(true);
    }
    // Anyone who can write edits it; the version check still refuses a stale save, and the creator stays the creator.
    let version = (await save("member-a2", draft.id, 1, "basics", { name: "Edited by a colleague" })).version;
    expect(await status(save("member-a", draft.id, 1, "basics", { name: "Stale" }))).toBe(409);
    version = (await save("admin-a", draft.id, version, "basics", { name: "Edited by an admin" })).version;
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id))).toMatchObject({ name: "Edited by an admin", createdBy: "member-a", version });
    expect((await fixture.admin.query("select actor_id from audit_logs where action='campaign.draft.save' and target_id=$1 order by created_at", [draft.id])).rows.map((r) => r.actor_id)).toEqual(["member-a2", "admin-a"]);
    // A plain member discards only a draft they started; a viewer and an outsider reach nothing.
    expect(await status(discardDraft(fixture.db, "member-a2", tenantA, draft.id, { version }))).toBe(403);
    expect(await status(getDraft(fixture.db, "viewer-a", tenantA, draft.id))).toBe(404);
    expect(await status(save("viewer-a", draft.id, version, "basics", { name: "Viewer" }))).toBe(403);
    expect((await discardDraft(fixture.db, "admin-a", tenantA, draft.id, { version })).status).toBe("discarded");
    expect((await discardDraft(fixture.db, "admin-a", tenantA, draft.id, { version })).status).toBe("discarded");
    expect(await status(save("member-a", draft.id, version + 1, "basics", { name: "Late" }))).toBe(409);
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
    // A draft keeps its ministry, creator and key whoever edits it.
    await expect(attempt("member-a", (tx) => tx.update(campaignDrafts).set({ createdBy: "member-a2" }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    await expect(attempt("member-a", (tx) => tx.update(campaignDrafts).set({ tenantId: tenantB }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    // A viewer cannot change anything; a colleague who can write can edit but not finish a draft against nothing, nor discard someone else's.
    expect((await attempt("viewer-a", (tx) => tx.update(campaignDrafts).set({ name: "Viewer" }).where(eq(campaignDrafts.id, draft.id)).returning())) as unknown[]).toEqual([]);
    await expect(attempt("member-a2", (tx) => tx.update(campaignDrafts).set({ status: "finished" }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    await expect(attempt("member-a2", (tx) => tx.update(campaignDrafts).set({ status: "discarded", version: 2 }).where(eq(campaignDrafts.id, draft.id)))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(attempt("admin-a", (tx) => tx.update(campaignDrafts).set({ status: "finished" }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    // Nobody marks a draft finished against some other campaign of the ministry.
    const other = await withTenant(fixture.db, "member-a", tenantA, "campaigns:write", (tx) => tx.insert(campaigns)
      .values({ tenantId: tenantA, ownerUserId: "member-a", name: "Other", type: "custom_project", idempotencyKey: key(), fingerprint: "d".repeat(64) }).returning({ id: campaigns.id }));
    for (const person of ["member-a", "member-a2"]) {
      await expect(attempt(person, (tx) => tx.update(campaignDrafts).set({ status: "finished", campaignId: other[0].id, finishedAt: new Date() }).where(eq(campaignDrafts.id, draft.id)))).rejects.toThrow();
    }
    // A campaign made for a draft needs that draft's creator as owner; a plain insert may not name another owner.
    await expect(withTenant(fixture.db, "member-a2", tenantA, "campaigns:write", (tx) => tx.insert(campaigns)
      .values({ tenantId: tenantA, ownerUserId: "member-a", name: "Hijack", type: "custom_project", idempotencyKey: key(), fingerprint: "e".repeat(64) }))).rejects.toThrow();
    // Assignments follow the draft: a colleague can place people, a viewer cannot.
    await attempt("member-a2", (tx) => tx.insert(campaignDraftAssignments).values({ tenantId: tenantA, draftId: draft.id, userId: "member-a2", department: "volunteers", role: "member" }));
    await expect(attempt("viewer-a", (tx) => tx.insert(campaignDraftAssignments).values({ tenantId: tenantA, draftId: draft.id, userId: "member-a2", department: "counseling", role: "member" }))).rejects.toThrow();
    expect(await attempt("viewer-a", (tx) => tx.select().from(campaignDraftAssignments))).toEqual([]);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).name).toBeNull();
    // The admin's plain discard still works.
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

describe("shared drafts: finishing", () => {
  it("lets a colleague finish any open draft and keeps the creator as the campaign's owner", async () => {
    const draft = await draftFor("member-a");
    const version = await complete("member-a", draft.id, 1);
    const finished = await finishDraft(fixture.db, "member-a2", tenantA, draft.id, { version });
    const [row] = (await fixture.admin.query("select owner_user_id, status from campaigns where id=$1", [finished.campaignId])).rows;
    expect(row).toEqual({ owner_user_id: "member-a", status: "draft" });
    expect((await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version })).campaignId).toBe(finished.campaignId);
    expect(await status(finishDraft(fixture.db, "viewer-a", tenantA, draft.id, { version }))).toBe(403);
    expect((await fixture.admin.query("select actor_id from audit_logs where action in ('campaign.draft.finish','campaign.create') and target_id in ($1,$2) order by action", [draft.id, finished.campaignId])).rows.map((r) => r.actor_id)).toEqual(["member-a2", "member-a2"]);
  });
  it("makes the person finishing the owner when the creator can no longer write campaigns", async () => {
    const draft = await draftFor("temp-a");
    const version = await complete("temp-a", draft.id, 1);
    await putMember(fixture.db, "owner-a", tenantA, "temp-a@example.test", "viewer");
    const finished = await finishDraft(fixture.db, "admin-a", tenantA, draft.id, { version });
    expect((await fixture.admin.query("select owner_user_id from campaigns where id=$1", [finished.campaignId])).rows).toEqual([{ owner_user_id: "admin-a" }]);
    await putMember(fixture.db, "owner-a", tenantA, "temp-a@example.test", "member");
  });
});

describe("campaign cover", () => {
  const intent = { kind: "cover", mime: "image/png", name: "logo.png", size: 12, checksum: "a".repeat(64) };
  const clean = { scan: vi.fn().mockResolvedValue("clean") }, infected = { scan: vi.fn().mockResolvedValue("infected") };
  const adapter = { presignUpload: vi.fn().mockResolvedValue({ url: "https://storage.example.test/upload", method: "PUT", expiresIn: 300, headers: {} }),
    inspect: vi.fn().mockResolvedValue({ size: intent.size, mime: intent.mime, checksum: intent.checksum }),
    presignDownload: vi.fn((key: string) => Promise.resolve(`https://storage.example.test/${key.split("/").at(-1)}`)) };
  const storage = () => adapter as never;
  const scope = (draftId: string, tenantId = tenantA) => ({ tenantId, draftId });
  async function readyFile(draftId: string, user = "member-a") {
    const { file } = await createDraftCoverUpload(fixture.db, user, scope(draftId), intent, storage);
    expect((await confirmDraftCoverUpload(fixture.db, user, scope(draftId), file.id, storage, clean)).status).toBe("ready");
    return file.id;
  }
  it("records a private pending file under the draft, then verifies and scans it before it can be used", async () => {
    const draft = await draftFor("member-a");
    const { file, upload } = await createDraftCoverUpload(fixture.db, "member-a2", scope(draft.id), intent, storage);
    expect(upload).toMatchObject({ method: "PUT" });
    expect(file).toMatchObject({ status: "pending", kind: "cover", mime: "image/png" });
    expect(adapter.presignUpload).toHaveBeenLastCalledWith(`workspaces/${tenantA}/campaign-drafts/${draft.id}/files/${file.id}`, expect.objectContaining({ visibility: "private" }));
    // Not ready: it cannot be chosen.
    expect(await status(setDraftCover(fixture.db, "member-a", scope(draft.id), { fileId: file.id, version: 1 }))).toBe(404);
    // Only the uploader moves it forward.
    expect(await status(confirmDraftCoverUpload(fixture.db, "member-a", scope(draft.id), file.id, storage, clean))).toBe(404);
    expect((await confirmDraftCoverUpload(fixture.db, "member-a2", scope(draft.id), file.id, storage, infected)).status).toBe("quarantined");
    expect(await status(setDraftCover(fixture.db, "member-a2", scope(draft.id), { fileId: file.id, version: 1 }))).toBe(404);
    expect(await status(createDraftCoverUpload(fixture.db, "viewer-a", scope(draft.id), intent, storage))).toBe(403);
    expect(await status(createDraftCoverUpload(fixture.db, "member-a", scope(draft.id), { ...intent, kind: "attachment" }, storage))).toBe(400);
  });
  it("chooses, replaces and removes the cover with the version check, and retires what it replaces", async () => {
    const draft = await draftFor("member-a");
    const first = await readyFile(draft.id), second = await readyFile(draft.id, "member-a2");
    const set = await setDraftCover(fixture.db, "member-a2", scope(draft.id), { fileId: first, version: 1 });
    expect(set).toEqual({ coverFileId: first, version: 2 });
    expect(await setDraftCover(fixture.db, "member-a2", scope(draft.id), { fileId: first, version: 1 })).toEqual(set); // a retried request
    expect(await status(setDraftCover(fixture.db, "member-a", scope(draft.id), { fileId: second, version: 1 }))).toBe(409);
    expect(await setDraftCover(fixture.db, "member-a", scope(draft.id), { fileId: second, version: 2 })).toEqual({ coverFileId: second, version: 3 });
    const retired = await fixture.admin.query("select id, retired_at is not null as retired from campaign_files where draft_id=$1 order by retired desc", [draft.id]);
    expect(retired.rows.filter((r) => r.retired).map((r) => r.id)).toEqual([first]);
    // The autosave keeps working with the version the cover moved on to.
    expect((await save("member-a", draft.id, 3, "basics", { name: "With a cover" })).version).toBe(4);
    expect((await getDraft(fixture.db, "member-a", tenantA, draft.id)).coverFileId).toBe(second);
    expect(await getDraftCoverUrl(fixture.db, "member-a2", scope(draft.id), storage)).toEqual({ url: `https://storage.example.test/${second}`, expiresIn: 60 });
    expect(await status(getDraftCoverUrl(fixture.db, "viewer-a", scope(draft.id), storage))).toBe(404);
    expect(await status(getDraftCoverUrl(fixture.db, "owner-b", scope(draft.id, tenantB), storage))).toBe(404);
    expect(await setDraftCover(fixture.db, "member-a", scope(draft.id), { fileId: null, version: 4 })).toEqual({ coverFileId: null, version: 5 });
    expect(await status(getDraftCoverUrl(fixture.db, "member-a", scope(draft.id), storage))).toBe(404);
    expect((await fixture.admin.query("select action from audit_logs where target_id=$1 and action='campaign.draft.cover'", [draft.id])).rows).toHaveLength(3);
  });
  it("refuses a file that belongs to another draft or ministry, and a closed draft", async () => {
    const draft = await draftFor("member-a"), other = await draftFor("member-a");
    const foreign = await readyFile(other.id);
    expect(await status(setDraftCover(fixture.db, "member-a", scope(draft.id), { fileId: foreign, version: 1 }))).toBe(404);
    // Direct SQL cannot get around it either.
    await expect(withTenant(fixture.db, "member-a", tenantA, "campaigns:write",
      (tx) => tx.update(campaignDrafts).set({ coverFileId: foreign }).where(eq(campaignDrafts.id, draft.id)))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(withTenant(fixture.db, "member-a", tenantA, "campaigns:write", (tx) => tx.insert(campaigns)
      .values({ tenantId: tenantA, ownerUserId: "member-a", name: "Borrowed", type: "custom_project", idempotencyKey: key(), fingerprint: "c".repeat(64), coverFileId: foreign }))).rejects.toMatchObject({ cause: { code: "23514" } });
    // Only the uploader moves a file's scan state, and never straight to ready.
    const pending = (await createDraftCoverUpload(fixture.db, "member-a", scope(draft.id), intent, storage)).file.id;
    await expect(withTenant(fixture.db, "member-a2", tenantA, "campaigns:write", (tx) => tx.update(campaignFiles).set({ status: "uploaded" }).where(eq(campaignFiles.id, pending)))).rejects.toThrow();
    await expect(withTenant(fixture.db, "member-a", tenantA, "campaigns:write", (tx) => tx.update(campaignFiles).set({ status: "ready" }).where(eq(campaignFiles.id, pending)))).rejects.toMatchObject({ cause: { code: "23514" } });
    const version = await complete("member-a", draft.id, 1);
    await discardDraft(fixture.db, "member-a", tenantA, draft.id, { version });
    expect(await status(createDraftCoverUpload(fixture.db, "member-a", scope(draft.id), intent, storage))).toBe(409);
    expect(await status(setDraftCover(fixture.db, "member-a", scope(draft.id), { fileId: null, version: version + 1 }))).toBe(409);
  });
  it("carries the cover to the campaign on Finish, readable by anyone who can read the campaign", async () => {
    const draft = await draftFor("member-a");
    const file = await readyFile(draft.id);
    let version = (await save("member-a", draft.id, 1, "basics", { name: "Cover campaign" })).version;
    version = (await save("member-a", draft.id, version, "place", place)).version;
    const { coverFileId, version: after } = await setDraftCover(fixture.db, "member-a2", scope(draft.id), { fileId: file, version });
    expect(coverFileId).toBe(file);
    const finished = await finishDraft(fixture.db, "member-a2", tenantA, draft.id, { version: after });
    expect((await fixture.admin.query("select cover_file_id from campaigns where id=$1", [finished.campaignId])).rows).toEqual([{ cover_file_id: file }]);
    for (const person of ["member-a", "viewer-a", "owner-a"]) expect((await getCampaignCoverUrl(fixture.db, person, { tenantId: tenantA, campaignId: finished.campaignId }, storage)).url).toBe(`https://storage.example.test/${file}`);
    expect(await status(getCampaignCoverUrl(fixture.db, "owner-b", { tenantId: tenantB, campaignId: finished.campaignId }, storage))).toBe(404);
    // A viewer reads that one file and no other.
    const other = await readyFile((await draftFor("member-a")).id);
    expect(await withTenant(fixture.db, "viewer-a", tenantA, "campaigns:read", (tx) => tx.select({ id: campaignFiles.id }).from(campaignFiles))).toEqual([{ id: file }]);
    expect(other).not.toBe(file);
    // A campaign without a cover has no cover address.
    const plain = await draftFor("member-a");
    const plainVersion = await complete("member-a", plain.id, 1);
    const plainDone = await finishDraft(fixture.db, "member-a", tenantA, plain.id, { version: plainVersion });
    expect(await status(getCampaignCoverUrl(fixture.db, "member-a", { tenantId: tenantA, campaignId: plainDone.campaignId }, storage))).toBe(404);
  });
});

describe("setup checklist", () => {
  /** A finished campaign whose draft included volunteers and counseling, so leaders can make items tick themselves. */
  async function campaignWithDepartments() {
    const draft = await draftFor("member-a");
    let version = (await save("member-a", draft.id, 1, "leaders", { departments: ["volunteers", "counseling"] })).version;
    version = await complete("member-a", draft.id, version);
    const { campaignId } = await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version });
    return { draftId: draft.id, campaignId };
  }
  it("lists the nine PRD items, stores completion per item and lets it be undone", async () => {
    const { campaignId } = await campaignWithDepartments();
    const first = await getChecklist(fixture.db, "member-a", tenantA, campaignId);
    expect(first.map((row) => row.item)).toEqual(["assign_leaders", "confirm_venues", "define_budget", "connect_payments", "publish_registration", "configure_qr", "assign_counseling", "invite_churches", "create_events"]);
    expect(first.every((row) => !row.done && !row.automatic)).toBe(true);
    const after = await setChecklistItem(fixture.db, "member-a", tenantA, campaignId, { item: "define_budget", done: true });
    expect(after.find((row) => row.item === "define_budget")).toMatchObject({ done: true, automatic: false });
    // Another person sees it, and can undo it: the row keeps who and when, and clears both when undone.
    expect((await getChecklist(fixture.db, "admin-a", tenantA, campaignId)).find((row) => row.item === "define_budget")?.done).toBe(true);
    expect((await fixture.admin.query("select done, done_by from campaign_checklist_items where campaign_id=$1", [campaignId])).rows).toEqual([{ done: true, done_by: "member-a" }]);
    await setChecklistItem(fixture.db, "admin-a", tenantA, campaignId, { item: "define_budget", done: false });
    expect((await fixture.admin.query("select done, done_by, done_at from campaign_checklist_items where campaign_id=$1", [campaignId])).rows).toEqual([{ done: false, done_by: null, done_at: null }]);
    await setChecklistItem(fixture.db, "member-a", tenantA, campaignId, { item: "define_budget", done: true });
    expect((await fixture.admin.query("select count(*)::int as n from campaign_checklist_items where campaign_id=$1", [campaignId])).rows[0].n).toBe(1);
    expect((await fixture.admin.query("select count(*)::int as n from audit_logs where action='campaign.checklist.set' and target_id=$1", [campaignId])).rows[0].n).toBe(3);
  });
  it("ticks leader items by itself from accepted leaders and ignores a stored untick", async () => {
    const { draftId, campaignId } = await campaignWithDepartments();
    expect((await getChecklist(fixture.db, "member-a", tenantA, campaignId)).filter((row) => row.automatic)).toEqual([]);
    // The draft is finished, so leaders are placed straight in the assignments table for this check.
    await fixture.admin.query("insert into campaign_draft_assignments (tenant_id, draft_id, user_id, department, role) values ($1,$2,'admin-a','counseling','leader')", [tenantA, draftId]);
    let rows = await getChecklist(fixture.db, "member-a", tenantA, campaignId);
    expect(rows.find((row) => row.item === "assign_counseling")).toMatchObject({ done: true, automatic: true });
    expect(rows.find((row) => row.item === "assign_leaders")).toMatchObject({ done: false, automatic: false }); // volunteers still has none
    await fixture.admin.query("insert into campaign_draft_assignments (tenant_id, draft_id, user_id, department, role) values ($1,$2,'member-a2','volunteers','leader')", [tenantA, draftId]);
    await setChecklistItem(fixture.db, "member-a", tenantA, campaignId, { item: "assign_leaders", done: false });
    rows = await getChecklist(fixture.db, "member-a", tenantA, campaignId);
    expect(rows.find((row) => row.item === "assign_leaders")).toMatchObject({ done: true, automatic: true });
  });
  it("is for people who can write campaigns, and stays inside the ministry", async () => {
    const { campaignId } = await campaignWithDepartments();
    expect(await status(getChecklist(fixture.db, "viewer-a", tenantA, campaignId))).toBe(403);
    expect(await status(setChecklistItem(fixture.db, "viewer-a", tenantA, campaignId, { item: "define_budget", done: true }))).toBe(403);
    expect(await status(getChecklist(fixture.db, "owner-b", tenantA, campaignId))).toBe(403);
    expect(await status(getChecklist(fixture.db, "owner-b", tenantB, campaignId))).toBe(404);
    expect(await status(setChecklistItem(fixture.db, "member-a", tenantA, campaignId, { item: "launch_rocket", done: true }))).toBe(400);
    expect(await status(setChecklistItem(fixture.db, "member-a", tenantA, campaignId, { item: "define_budget", done: true, extra: 1 }))).toBe(400);
    expect(await status(setChecklistItem(fixture.db, "member-a", tenantA, "00000000-0000-4000-8000-000000000000", { item: "define_budget", done: true }))).toBe(404);
  });
  it("forces RLS, grants no delete, no whole-table update, and a write cannot name another person", async () => {
    const { campaignId } = await campaignWithDepartments();
    expect((await fixture.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname='campaign_checklist_items'")).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect((await fixture.admin.query("select has_table_privilege('harvest_app','campaign_checklist_items','DELETE') as d, has_table_privilege('harvest_app','campaign_checklist_items','UPDATE') as u, has_table_privilege('public','campaign_checklist_items','SELECT') as p")).rows)
      .toEqual([{ d: false, u: false, p: false }]);
    await expect(withTenant(fixture.db, "member-a", tenantA, "campaigns:write", (tx) => tx.insert(campaignChecklistItems).values({ tenantId: tenantA, campaignId, item: "create_events", done: true, doneBy: "admin-a", doneAt: new Date() }))).rejects.toThrow();
  });
});

describe("campaign overview", () => {
  it("reads the finished draft's departments, leaders, members and tools, and reports what is not tracked as unavailable", async () => {
    const draft = await draftFor("member-a");
    let version = (await save("member-a", draft.id, 1, "leaders", { departments: ["volunteers", "counseling"] })).version;
    version = await complete("member-a", draft.id, version);
    version = (await save("member-a", draft.id, version, "tools", { modules: ["tasks_boards", "campaign_calendar"] })).version;
    const lead = await invite("member-a", draft.id, { department: "volunteers", role: "leader", userId: "admin-a" });
    await acceptInvitation(fixture.db, "admin-a", { token: lead.token });
    await invite("member-a", draft.id, { department: "volunteers", role: "member", email: "later@example.test" }); // pending
    const { campaignId } = await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version });
    const overview = await getCampaignOverview(fixture.db, "member-a", tenantA, campaignId);
    expect(overview.configuration).toEqual({
      departments: [{ key: "volunteers", leaders: ["admin-a"], members: [], pending: 1 }, { key: "counseling", leaders: [], members: [], pending: 0 }], // the PRD's order
      modules: ["tasks_boards", "campaign_calendar"],
    });
    expect(overview.checklist).toEqual({ done: 0, total: 9 });
    expect(overview.unavailable).toEqual(["progress", "events", "funding", "tasks"]);
    expect(JSON.stringify(overview)).not.toMatch(/example\.test/); // no email address of an invitee or placed person
  });
  it("is for people who can write campaigns, stays inside the ministry, and has nothing for a campaign made without the wizard", async () => {
    const draft = await draftFor("member-a");
    const { campaignId } = await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version: await complete("member-a", draft.id, 1) });
    expect(await status(getCampaignOverview(fixture.db, "viewer-a", tenantA, campaignId))).toBe(403);
    expect(await status(getCampaignOverview(fixture.db, "owner-b", tenantA, campaignId))).toBe(403);
    expect(await status(getCampaignOverview(fixture.db, "owner-b", tenantB, campaignId))).toBe(404);
    const made = await fixture.admin.query("insert into campaigns (tenant_id, owner_user_id, type, name, idempotency_key, fingerprint) values ($1,'owner-a','conference','No wizard','plain-overview',repeat('a',64)) returning id", [tenantA]);
    expect((await getCampaignOverview(fixture.db, "owner-a", tenantA, made.rows[0].id)).configuration).toBeNull();
  });
});
