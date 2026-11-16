import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { hc13Fixture } from "./hc13-fixture";
import { assignFollowUpCase, getFollowUpCase, listFollowUpCases, openEligibleFollowUpCases, transitionFollowUpCase } from "../../src/server/follow-up-cases";
import { eraseConnectResponse, eraseContactForTest } from "./hc13-owner-helpers";
import { putMember } from "../../src/server/workspaces";
import { recordConsent } from "../../src/server/contacts";

// HC-13 with a real non-superuser, non-BYPASSRLS migration owner: FORCE RLS applies to the definer owner, so every table a definer or hook
// touches needs the owner's own tenant policy. The same flows as the main suite, through the real code.
it("runs the case lifecycle, hooks and erasure as a restricted owner", async () => {
  const ctx = await hc13Fixture({ migrationOwner: true });
  try {
    const owner = (await ctx.f.admin.query("select pg_get_userbyid(proowner) as o, (select rolbypassrls or rolsuper from pg_roles where rolname = pg_get_userbyid(proowner)) as bypass from pg_proc where proname = 'assign_followup_case'")).rows[0];
    expect(owner.bypass).toBe(false);
    const a = await ctx.seedAssociated(), b = await ctx.seedAssociated(), c = await ctx.seedAssociated();
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-admin", ctx.tenantA)).toEqual({ opened: 3 });
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA)).toEqual({ opened: 0 });
    const [ca, cb, cc] = await Promise.all([a, b, c].map(async (x) => (await ctx.caseOf(x.response))!));
    await transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, ca, { to: "awaiting_assignment", version: 1 });
    const assigned = await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, ca, { assigneeId: "d-member", version: 2 });
    expect(assigned).toMatchObject({ state: "assigned", assigneeId: "d-member", version: 3 });
    expect((await listFollowUpCases(ctx.f.db, "d-member", ctx.tenantA)).items.map((item) => item.id)).toEqual([ca]);
    expect((await listFollowUpCases(ctx.f.db, "d-member2", ctx.tenantA)).items).toEqual([]);
    expect(await getFollowUpCase(ctx.f.db, "d-member", ctx.tenantA, ca)).toMatchObject({ id: ca });
    await expect(getFollowUpCase(ctx.f.db, "d-member", ctx.tenantA, cb)).rejects.toMatchObject({ status: 403 });
    await expect(getFollowUpCase(ctx.f.db, "d-viewer", ctx.tenantA, ca)).rejects.toMatchObject({ status: 403 });
    await transitionFollowUpCase(ctx.f.db, "d-member", ctx.tenantA, ca, { to: "attempted", version: 3 });
    expect((await listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA)).items.length).toBeGreaterThanOrEqual(3);
    // Revocation hook and audit as the restricted owner.
    await putMember(ctx.f.db, "d-owner", ctx.tenantA, "d-member@example.test", "viewer");
    expect(await ctx.caseRow(ca)).toMatchObject({ state: "awaiting_assignment", assignee_id: null });
    expect((await ctx.audit("followup.case.revoke")).map((row) => row.target_id)).toEqual([ca]);
    // Merge hook, response erasure hook and contact erasure hook.
    expect(await eraseConnectResponse(ctx.f.db, "d-owner", ctx.tenantA, b.response)).toEqual({ erased: true });
    expect(await ctx.caseRow(cb)).toBeUndefined();
    expect(await eraseContactForTest(ctx.f.db, "d-owner", ctx.tenantA, c.contactId)).toEqual({ erased: true });
    expect(await ctx.caseRow(cc)).toBeUndefined();
    expect(await ctx.caseRow(ca)).toBeDefined();
    const sweep = (await ctx.f.admin.query("select count(*)::int as n from followup_cases")).rows[0].n;
    expect(sweep).toBe(1);
    expect((await ctx.f.admin.query("select polname from pg_policy p join pg_class k on k.oid = p.polrelid where k.relname = 'followup_cases' order by 1")).rows.map((row) => row.polname)).toEqual(["followup_cases_read", "followup_definer_tenant"]);
  } finally { await ctx.f.close(); }
});

// Consent follow-up (migration 0050) as a restricted owner: a withdrawal recorded by a member on a different channel blocks open, assign and attempt.
it("refuses open, assign and attempt after a member's withdrawal on another channel, as a restricted owner", async () => {
  const ctx = await hc13Fixture({ migrationOwner: true });
  try {
    const blocked = await ctx.seedAssociated(), open = await ctx.seedAssociated();
    await recordConsent(ctx.f.db, "d-member", ctx.tenantA, blocked.contactId, { channel: "sms", status: "withdrawn", purpose: "outreach_follow_up", noticeVersion: "notice-v1", source: "Phone call", evidence: "Opt-out received by a member" });
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA)).toEqual({ opened: 1 });
    expect(await ctx.caseOf(blocked.response)).toBeUndefined();
    const id = (await ctx.caseOf(open.response))!;
    await transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, id, { to: "awaiting_assignment", version: 1 });
    await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, id, { assigneeId: "d-member", version: 2 });
    await recordConsent(ctx.f.db, "d-member", ctx.tenantA, open.contactId, { channel: "social", status: "withdrawn", purpose: "outreach_follow_up", noticeVersion: "notice-v1", source: "Message", evidence: "Opt-out received by a member" });
    await expect(transitionFollowUpCase(ctx.f.db, "d-member", ctx.tenantA, id, { to: "attempted", version: 3 })).rejects.toMatchObject({ status: 403 });
    await expect(assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, id, { assigneeId: "d-member2", version: 3 })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    expect((await ctx.f.admin.query("select pg_get_userbyid(proowner) = (select pg_get_userbyid(proowner) from pg_proc where proname = 'assign_followup_case') as same from pg_proc where proname = 'followup_consent_effective'")).rows[0].same).toBe(true);
  } finally { await ctx.f.close(); }
});
