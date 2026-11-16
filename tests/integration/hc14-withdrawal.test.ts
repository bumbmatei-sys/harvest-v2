import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { hc13Fixture } from "./hc13-fixture";
import { assignFollowUpCase, getFollowUpCase, listFollowUpCases, openEligibleFollowUpCases, transitionFollowUpCase } from "../../src/server/follow-up-cases";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { withTenant } from "../../src/server/tenancy";
import { putMember } from "../../src/server/workspaces";
import { followUpCaseStates, followUpTransitionAllowed } from "../../src/lib/follow-up-cases";

vi.mock("server-only", () => ({}));
const proof = { purpose: "outreach_follow_up", noticeVersion: "notice-v1", source: "Synthetic request", evidence: "Synthetic evidence" } as const;
for (const migrationOwner of [false, true]) describe(`HC-14 withdrawal (restricted owner: ${migrationOwner})`, () => {
  let ctx: Awaited<ReturnType<typeof hc13Fixture>>;
  beforeAll(async () => { ctx = await hc13Fixture({ migrationOwner }); });
  afterAll(async () => { await ctx?.f.close(); vi.unstubAllEnvs(); });
  const ledger = (contact: string, channel: "email" | "sms" | "social", status: "withdrawn" | "granted", purpose: "outreach_follow_up" | "newsletter" = proof.purpose) =>
    recordConsent(ctx.f.db, status === "withdrawn" ? "d-member" : "d-owner", ctx.tenantA, contact, { ...proof, purpose, channel, status });
  async function at(state: string) {
    const c = await ctx.seedCase();
    const move = async (to: string) => transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, c.caseId, { to, version: (await ctx.caseRow(c.caseId))!.version });
    if (state !== "requested") await move("awaiting_assignment");
    if (!["requested", "awaiting_assignment"].includes(state)) await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, c.caseId, { assigneeId: "d-member", version: 2 });
    if (["attempted", "no_response", "connected", "closed"].includes(state)) await move("attempted");
    if (state === "no_response") await move("no_response");
    if (["connected", "closed"].includes(state)) await move("connected");
    if (state === "closed") await move("closed");
    return c;
  }
  it("propagates every channel through every non-terminal state; preserves closed cases and DB/TS parity", async () => {
    for (const [i, state] of ["requested", "awaiting_assignment", "assigned", "attempted", "no_response", "connected", "closed"].entries()) {
      const c = await at(state), previous = (await ctx.caseRow(c.caseId))!;
      await ledger(c.contactId, (["email", "sms", "social"] as const)[i % 3], "withdrawn");
      expect(await ctx.caseRow(c.caseId)).toMatchObject(state === "closed" ? previous : { state: "withdrawn", assignee_id: null, version: previous.version + 1 });
      const events = (await ctx.audit("followup.case.withdraw")).filter((row) => row.target_id === c.caseId);
      expect(events).toHaveLength(state === "closed" ? 0 : 1);
      if (state !== "closed") expect(events[0]).toMatchObject({ actor_id: null, metadata: { from: state, to: "withdrawn" } });
    }
    for (const from of followUpCaseStates) for (const to of followUpCaseStates) {
      expect((await ctx.f.admin.query("select followup_case_transition_allowed($1,$2) as ok", [from, to])).rows[0].ok).toBe(followUpTransitionAllowed(from, to));
    }
  });
  it("is idempotent on repeated withdrawals; later grants never reopen a case or restore counselor access", async () => {
    const c = await at("assigned");
    expect(await getFollowUpCase(ctx.f.db, "d-member", ctx.tenantA, c.caseId)).toMatchObject({ state: "assigned" });
    await ledger(c.contactId, "sms", "withdrawn");
    const withdrawn = await ctx.caseRow(c.caseId);
    await ledger(c.contactId, "sms", "withdrawn");
    await ledger(c.contactId, "sms", "granted");
    expect(await ctx.caseRow(c.caseId)).toEqual(withdrawn);
    expect((await ctx.audit("followup.case.withdraw")).filter((row) => row.target_id === c.caseId)).toHaveLength(1);
    expect((await listFollowUpCases(ctx.f.db, "d-member", ctx.tenantA)).items.map((row) => row.id)).not.toContain(c.caseId);
    await expect(getFollowUpCase(ctx.f.db, "d-member", ctx.tenantA, c.caseId)).rejects.toMatchObject({ status: 403 });
    await expect(transitionFollowUpCase(ctx.f.db, "d-member", ctx.tenantA, c.caseId, { to: "attempted", version: 3 })).rejects.toMatchObject({ status: 403 });
    await expect(assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, c.caseId, { assigneeId: "d-member", version: withdrawn!.version })).rejects.toMatchObject({ status: 409 });
    await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA);
    expect(await ctx.caseOf(c.response)).toBe(c.caseId);
    expect(await ctx.caseRow(c.caseId)).toEqual(withdrawn);
  });
  it("keeps other purposes and the other ministry isolated, and refuses forged tenant withdrawals", async () => {
    const c = await at("assigned"), other = await createContact(ctx.f.db, "d-other", ctx.tenantB, { name: "Synthetic B" });
    await ledger(c.contactId, "email", "withdrawn", "newsletter");
    await recordConsent(ctx.f.db, "d-other", ctx.tenantB, other.id, { ...proof, channel: "sms", status: "withdrawn" });
    await expect(recordConsent(ctx.f.db, "d-other", ctx.tenantB, c.contactId, { ...proof, channel: "email", status: "withdrawn" })).rejects.toMatchObject({ status: 404 });
    expect(await ctx.caseRow(c.caseId)).toMatchObject({ state: "assigned" });
    await ledger(c.contactId, "social", "withdrawn");
    expect(await ctx.caseRow(c.caseId)).toMatchObject({ state: "withdrawn" });
    expect((await ctx.f.admin.query("select count(*)::int as n from audit_logs where tenant_id=$1 and action='followup.case.withdraw'", [ctx.tenantB])).rows[0].n).toBe(0);
  });
  it("rolls back both the ledger insertion and automatic transition/audit together", async () => {
    const c = await at("assigned");
    await expect(withTenant(ctx.f.db, "d-member", ctx.tenantA, "contacts:record_withdrawal", async (tx) => {
      await tx.execute(sql`insert into contact_consents (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence)
        values (${ctx.tenantA},${c.contactId},'d-member','outreach_follow_up','notice-v1','sms','withdrawn','Synthetic','Synthetic')`);
      expect((await tx.execute(sql`select state from followup_cases where id=${c.caseId}`)).rows).toEqual([]);
      throw new Error("rollback synthetic request");
    })).rejects.toThrow("rollback synthetic request");
    expect(await ctx.caseRow(c.caseId)).toMatchObject({ state: "assigned", version: 3 });
    expect((await ctx.audit("followup.case.withdraw")).filter((row) => row.target_id === c.caseId)).toEqual([]);
  });
  it("applies withdrawals on either side of a merge and preserves already superseded historical withdrawals", async () => {
    const source = await at("assigned"), target = await createContact(ctx.f.db, "d-owner", ctx.tenantA, { name: "Synthetic kept" });
    await ledger(target.id, "sms", "withdrawn");
    await mergeContacts(ctx.f.db, "d-owner", ctx.tenantA, target.id, { sourceId: source.contactId, targetVersion: 1, sourceVersion: 1 });
    expect(await ctx.caseRow(source.caseId)).toMatchObject({ state: "withdrawn", contact_id: target.id });
    const live = await at("assigned"), optedOut = await createContact(ctx.f.db, "d-owner", ctx.tenantA, { name: "Synthetic opted out" });
    await ledger(optedOut.id, "social", "withdrawn");
    await mergeContacts(ctx.f.db, "d-owner", ctx.tenantA, live.contactId, { sourceId: optedOut.id, targetVersion: 1, sourceVersion: 1 });
    expect(await ctx.caseRow(live.caseId)).toMatchObject({ state: "withdrawn" });
    const stillLive = await at("assigned"), historical = await createContact(ctx.f.db, "d-owner", ctx.tenantA, { name: "Synthetic history" });
    await ledger(historical.id, "sms", "withdrawn"); await ledger(historical.id, "sms", "granted");
    await mergeContacts(ctx.f.db, "d-owner", ctx.tenantA, stillLive.contactId, { sourceId: historical.id, targetVersion: 1, sourceVersion: 1 });
    expect(await ctx.caseRow(stillLive.caseId)).toMatchObject({ state: "assigned" });
  });
  it("withdraws all cases for a contact after multiple responses have been merged", async () => {
    const first = await at("assigned"), second = await at("requested");
    await mergeContacts(ctx.f.db, "d-owner", ctx.tenantA, first.contactId, { sourceId: second.contactId, targetVersion: 1, sourceVersion: 1 });
    await ledger(first.contactId, "sms", "withdrawn");
    for (const c of [first, second]) expect(await ctx.caseRow(c.caseId)).toMatchObject({ state: "withdrawn", assignee_id: null, contact_id: first.contactId });
    const targets = (await ctx.audit("followup.case.withdraw")).map((row) => row.target_id);
    expect(targets.filter((id) => id === first.caseId || id === second.caseId)).toHaveLength(2);
  });
  it("audits withdrawal before erasure deletes the case, without preserving a contact or response link", async () => {
    const c = await at("assigned");
    await eraseContact(ctx.f.db, "d-owner", ctx.tenantA, c.contactId);
    expect(await ctx.caseRow(c.caseId)).toBeUndefined();
    const rows = (await ctx.audit("followup.case.withdraw")).filter((row) => row.target_id === c.caseId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(c.contactId); expect(JSON.stringify(rows)).not.toContain(c.response);
  });
  it("uses a system actor for automatic member revocations and rejects app impersonation of system audit rows", async () => {
    const c = await at("assigned");
    await putMember(ctx.f.db, "d-owner", ctx.tenantA, "d-member@example.test", "viewer");
    expect((await ctx.audit("followup.case.revoke")).find((row) => row.target_id === c.caseId)?.actor_id).toBeNull();
    await putMember(ctx.f.db, "d-owner", ctx.tenantA, "d-member@example.test", "member");
    await expect(withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(sql`insert into audit_logs (tenant_id,actor_id,action) values (${ctx.tenantA},null,'followup.case.withdraw')`))).rejects.toThrow();
    for (const fn of [sql`select withdraw_followup_cases(${ctx.tenantA},${c.contactId})`, sql`select followup_withdrawal_recorded(${ctx.tenantA},${c.contactId},${c.response})`]) {
      await expect(withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(fn))).rejects.toThrow();
    }
    const hardened = (await ctx.f.admin.query("select proconfig from pg_proc where proname in ('withdraw_followup_cases','followup_consent_withdrawn','followup_member_revoked','followup_case_response_moved','followup_case_response_erased')")).rows;
    expect(hardened).toHaveLength(5);
    for (const row of hardened) expect(row.proconfig).toContain("search_path=pg_catalog, pg_temp");
    expect((await ctx.f.admin.query("select polname from pg_policy where polrelid='followup_cases'::regclass order by polname")).rows.map((row) => row.polname)).toEqual(["followup_cases_read", "followup_definer_tenant"]);
  });
});
