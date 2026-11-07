import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { aiToolApprovals, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, linkCompany, recordConsent } from "../../src/server/contacts";
import { createCompany } from "../../src/server/companies";
import { createDeal, listPipelines, moveDeal } from "../../src/server/crm-deals";
import { createNote, createTask } from "../../src/server/crm-tasks";
import { recordAssociation } from "../../src/server/crm-associations";
import { createFieldDefinition, patchRecordFields } from "../../src/server/crm-fields";
import { decideToolApproval, describeCrmTools, executeCrmTool, requestToolApproval, toolArgsHash } from "../../src/server/ai/crm-tools";

let fixture: Awaited<ReturnType<typeof testDatabase>>, tenantA: string, tenantB: string, person: string, org: string, deal: string;
const taskArgs = { title: "Call back about the youth trip" };

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "member-a", "member-b", "viewer-a", "owner-b"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "CRM-08 tools A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "CRM-08 tools B")).tenantId;
  await putMember(fixture.db, "owner-a", tenantA, "member-a@example.test", "member");
  await putMember(fixture.db, "owner-a", tenantA, "member-b@example.test", "member");
  await putMember(fixture.db, "owner-a", tenantA, "viewer-a@example.test", "viewer");
  // A record full of things the assistant must not see.
  org = (await createCompany(fixture.db, "owner-a", tenantA, { name: "Synthetic Grace Chapel", domain: "grace.example", description: "Sunday services" })).id;
  person = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ana", email: "ana@example.test", notes: "SECRET-PERSON-NOTES pastoral" })).id;
  await linkCompany(fixture.db, "owner-a", tenantA, person, { companyId: org, title: "Youth leader" });
  await recordConsent(fixture.db, "owner-a", tenantA, person, { channel: "email", status: "granted", purpose: "messaging", noticeVersion: "notice-v1", source: "SECRET-CONSENT-SOURCE", evidence: "SECRET-CONSENT-EVIDENCE" });
  await recordAssociation(fixture.db, "owner-a", tenantA, { source: "form", kind: "form_submission", purpose: "messaging", contactId: person, summary: "SECRET-ACTIVITY-SUMMARY", payload: { raw: "SECRET-ACTIVITY-PAYLOAD" } });
  await createNote(fixture.db, "owner-a", tenantA, { target: "person", targetId: person, body: "SECRET-NOTE-BODY" });
  await createTask(fixture.db, "member-a", tenantA, { title: "Visit Ana", body: "SECRET-TASK-BODY", contactId: person, assigneeUserId: "member-a" });
  const field = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Prayer request", type: "text" });
  const current = await fixture.admin.query("select version from contacts where id = $1", [person]);
  await patchRecordFields(fixture.db, "owner-a", tenantA, "person", person, { version: current.rows[0].version, values: { [field.key]: "SECRET-CUSTOM-FIELD" } });
  const created = await createDeal(fixture.db, "owner-a", tenantA, { name: "Synthetic Retreat", amount: "500.00", contactId: person, companyId: org });
  const won = (await listPipelines(fixture.db, "owner-a", tenantA))[0].stages.find((stage) => stage.kind === "won")!;
  await moveDeal(fixture.db, "owner-a", tenantA, created.id, { stageId: won.id, version: created.version, closedReason: "SECRET-CLOSED-REASON" });
  deal = created.id;
});
afterAll(async () => { await fixture?.close(); });

describe("read tools", () => {
  it("lists only the tools the caller's role may use, each with a JSON input schema", async () => {
    const forViewer = await describeCrmTools(fixture.db, "viewer-a", tenantA), forMember = await describeCrmTools(fixture.db, "member-a", tenantA);
    expect(forViewer.every((tool) => tool.mode === "read")).toBe(true);
    expect(forMember.filter((tool) => tool.requiresApproval).map((tool) => tool.name).sort()).toEqual(["crm_create_task", "crm_move_deal"]);
    expect(forMember.find((tool) => tool.name === "crm_get_person")!.inputSchema).toMatchObject({ type: "object", required: ["personId"], additionalProperties: false });
    await expect(describeCrmTools(fixture.db, "owner-b", tenantA)).rejects.toMatchObject({ status: 403 });
  });

  it("answers through the app's services and never returns notes, custom values, consent evidence, bodies, close reasons or activity content", async () => {
    const outputs = [
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_search_people", { query: "Ana" }),
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_get_person", { personId: person }),
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_search_organizations", { query: "grace" }),
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_get_organization", { organizationId: org }),
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_get_timeline", { subject: "person", recordId: person }),
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_get_timeline", { subject: "organization", recordId: org }),
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_get_deal", { dealId: deal }),
      await executeCrmTool(fixture.db, "viewer-a", tenantA, "crm_list_related_deals", { subject: "person", recordId: person }),
      await executeCrmTool(fixture.db, "member-a", tenantA, "crm_list_my_tasks", {}),
    ];
    const dump = JSON.stringify(outputs);
    expect(dump).not.toContain("SECRET");
    expect(outputs[0]).toMatchObject({ total: 1, people: [{ id: person, name: "Synthetic Ana", email: "ana@example.test", organizations: [{ id: org, name: "Synthetic Grace Chapel", title: "Youth leader" }] }] });
    expect(outputs[1]).toMatchObject({ consent: [{ purpose: "messaging", channel: "email", status: "granted" }] });
    const timeline = (outputs[4] as { items: { kind: string; text?: unknown; source?: string; purpose?: string }[] }).items;
    // The note and the recorded activity are visible as entries, without their text (consent purpose is not assistant processing).
    expect(timeline.find((item) => item.kind === "note")).toMatchObject({ text: null });
    expect(timeline.find((item) => item.kind === "activity")).toMatchObject({ source: "form", purpose: "messaging" });
    expect(outputs[6]).toMatchObject({ id: deal, stage: { kind: "won" } });
    expect(outputs[8]).toMatchObject({ tasks: [{ title: "Visit Ana", person: { id: person } }] });
  });

  it("denies other workspaces, unknown records, unknown tools and malformed input", async () => {
    await expect(executeCrmTool(fixture.db, "owner-b", tenantA, "crm_get_person", { personId: person })).rejects.toMatchObject({ status: 403 });
    await expect(executeCrmTool(fixture.db, "owner-b", tenantB, "crm_get_person", { personId: person })).rejects.toMatchObject({ status: 404 });
    await expect(executeCrmTool(fixture.db, "owner-b", tenantB, "crm_get_timeline", { subject: "person", recordId: person })).rejects.toMatchObject({ status: 404 });
    expect(await executeCrmTool(fixture.db, "owner-b", tenantB, "crm_search_people", { query: "Ana" })).toMatchObject({ total: 0, people: [] });
    await expect(executeCrmTool(fixture.db, "owner-a", tenantA, "crm_run_sql", { sql: "select 1" })).rejects.toMatchObject({ status: 404 });
    await expect(executeCrmTool(fixture.db, "owner-a", tenantA, "toString", {})).rejects.toMatchObject({ status: 404 });
    await expect(executeCrmTool(fixture.db, "owner-a", tenantA, "crm_get_person", { personId: person, includeNotes: true })).rejects.toThrow();
  });
});

describe("approval gate for write tools", () => {
  it("fails closed without an approval, while pending, and for a viewer who may not write", async () => {
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs)).rejects.toMatchObject({ status: 403, details: { reason: "approval_required" } });
    const pending = await requestToolApproval(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs);
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs, { approvalId: pending.approvalId })).rejects.toMatchObject({ status: 403, details: { reason: "approval_pending" } });
    await expect(requestToolApproval(fixture.db, "viewer-a", tenantA, "crm_create_task", taskArgs)).rejects.toMatchObject({ status: 403 });
    await expect(requestToolApproval(fixture.db, "member-a", tenantA, "crm_get_person", { personId: person })).rejects.toMatchObject({ status: 404 });
  });

  it("runs exactly the approved action once, for the approving person only", async () => {
    const tasks = async () => Number((await fixture.admin.query("select count(*) from crm_tasks where tenant_id = $1 and title = $2", [tenantA, taskArgs.title])).rows[0].count);
    const before = await tasks();
    const { approvalId } = await requestToolApproval(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs);
    // Only the person it was requested for can decide it.
    await expect(decideToolApproval(fixture.db, "member-b", tenantA, approvalId, "approve")).rejects.toMatchObject({ status: 404 });
    await expect(decideToolApproval(fixture.db, "owner-a", tenantA, approvalId, "approve")).rejects.toMatchObject({ status: 404 });
    await decideToolApproval(fixture.db, "member-a", tenantA, approvalId, "approve");
    await expect(decideToolApproval(fixture.db, "member-a", tenantA, approvalId, "approve")).rejects.toMatchObject({ status: 409 });
    // Mismatches: other arguments, other tool, other person, other workspace.
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", { title: "Something else" }, { approvalId })).rejects.toMatchObject({ details: { reason: "approval_mismatch" } });
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", { ...taskArgs, priority: "high" }, { approvalId })).rejects.toMatchObject({ details: { reason: "approval_mismatch" } });
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_move_deal", { dealId: deal, stageId: deal, version: 1 }, { approvalId })).rejects.toMatchObject({ details: { reason: "approval_mismatch" } });
    await expect(executeCrmTool(fixture.db, "member-b", tenantA, "crm_create_task", taskArgs, { approvalId })).rejects.toMatchObject({ details: { reason: "approval_mismatch" } });
    await expect(executeCrmTool(fixture.db, "owner-b", tenantB, "crm_create_task", taskArgs, { approvalId })).rejects.toMatchObject({ status: 403 });
    expect(await tasks()).toBe(before);
    // The approved call runs once (defaults are part of the approved arguments)...
    const result = await executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", { ...taskArgs, priority: "none" }, { approvalId }) as { id: string };
    expect(await tasks()).toBe(before + 1);
    expect((await fixture.admin.query("select assignee_user_id, created_by from crm_tasks where id = $1", [result.id])).rows[0]).toEqual({ assignee_user_id: "member-a", created_by: "member-a" });
    // ...and a replay is refused.
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs, { approvalId })).rejects.toMatchObject({ status: 409, details: { reason: "approval_used" } });
    expect(await tasks()).toBe(before + 1);
    const ledger = (await fixture.admin.query("select action from audit_logs where tenant_id = $1 and target_id = $2 order by created_at, id", [tenantA, approvalId])).rows.map((row) => row.action);
    expect(ledger).toEqual(["ai.tool_approval_request", "ai.tool_approval_approve", "ai.tool_execute"]);
  });

  it("refuses rejected and expired approvals", async () => {
    const rejected = await requestToolApproval(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs);
    await decideToolApproval(fixture.db, "member-a", tenantA, rejected.approvalId, "reject");
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs, { approvalId: rejected.approvalId })).rejects.toMatchObject({ status: 409, details: { reason: "approval_used" } });
    // An approval that was approved but has since expired (created 20 minutes ago, valid for 10).
    const hash = toolArgsHash("crm_create_task", { title: taskArgs.title, dueAt: null, priority: "none", personId: null, organizationId: null, dealId: null });
    const [{ id }] = (await fixture.admin.query(`with ctx as (select set_config('app.user_id', 'member-a', true))
      insert into ai_tool_approvals (tenant_id, tool, args_hash, requested_by, status, expires_at, created_at) select $1, 'crm_create_task', $2, 'member-a', 'pending', now() - interval '10 minutes', now() - interval '20 minutes' from ctx returning id`, [tenantA, hash])).rows;
    await expect(decideToolApproval(fixture.db, "member-a", tenantA, id, "approve")).rejects.toMatchObject({ status: 409 });
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs, { approvalId: id })).rejects.toMatchObject({ status: 403, details: { reason: "approval_pending" } });
    // Approved in time, used too late. (Seeded with the guard off: the guard itself refuses to write an expired approval.)
    await fixture.admin.query("alter table ai_tool_approvals disable trigger ai_tool_approval_guard");
    let late: string;
    try {
      late = (await fixture.admin.query(`insert into ai_tool_approvals (tenant_id, tool, args_hash, requested_by, status, decided_at, expires_at, created_at)
        values ($1, 'crm_create_task', $2, 'member-a', 'approved', now() - interval '15 minutes', now() - interval '1 second', now() - interval '20 minutes') returning id`, [tenantA, hash])).rows[0].id;
    } finally { await fixture.admin.query("alter table ai_tool_approvals enable trigger ai_tool_approval_guard"); }
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs, { approvalId: late })).rejects.toMatchObject({ status: 409, details: { reason: "approval_expired" } });
    expect((await fixture.admin.query("select status from ai_tool_approvals where id = $1", [late])).rows[0].status).toBe("approved");
  });

  it("checks permissions again at execution and does not spend the approval when the action fails", async () => {
    const moveArgs = async () => {
      const current = await executeCrmTool(fixture.db, "member-a", tenantA, "crm_get_deal", { dealId: deal }) as { version: number; stages: { id: string; kind: string }[] };
      return { dealId: deal, stageId: current.stages.find((stage) => stage.kind === "open")!.id, version: current.version };
    };
    const args = await moveArgs();
    const { approvalId } = await requestToolApproval(fixture.db, "member-a", tenantA, "crm_move_deal", args);
    await decideToolApproval(fixture.db, "member-a", tenantA, approvalId, "approve");
    // Demoted to viewer after approving: refused, approval untouched.
    await putMember(fixture.db, "owner-a", tenantA, "member-a@example.test", "viewer");
    try { await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_move_deal", args, { approvalId })).rejects.toMatchObject({ status: 403 }); }
    finally { await putMember(fixture.db, "owner-a", tenantA, "member-a@example.test", "member"); }
    expect((await fixture.admin.query("select status from ai_tool_approvals where id = $1", [approvalId])).rows[0].status).toBe("approved");
    // Someone else moved the deal first: the stale write fails and the approval is still not spent.
    const other = await moveArgs();
    await moveDeal(fixture.db, "owner-a", tenantA, deal, { stageId: (await listPipelines(fixture.db, "owner-a", tenantA))[0].stages.find((stage) => stage.kind === "lost")!.id, version: other.version });
    await expect(executeCrmTool(fixture.db, "member-a", tenantA, "crm_move_deal", args, { approvalId })).rejects.toMatchObject({ status: 409 });
    expect((await fixture.admin.query("select status from ai_tool_approvals where id = $1", [approvalId])).rows[0].status).toBe("approved");
  });

  it("enforces the approval rules in SQL too, under RLS", async () => {
    const { approvalId } = await requestToolApproval(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs);
    const as = (user: string, run: (tx: Parameters<Parameters<typeof fixture.db.transaction>[0]>[0]) => Promise<unknown>) => fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, true), set_config('app.user_id', ${user}, true)`);
      return run(tx);
    });
    const where = sql`id = ${approvalId}::uuid`;
    // Approving someone else's request, approving with changed arguments, or skipping to consumed all fail.
    await expect(as("member-b", (tx) => tx.update(aiToolApprovals).set({ status: "approved", decidedAt: new Date() }).where(where))).rejects.toThrow();
    await expect(as("member-a", (tx) => tx.update(aiToolApprovals).set({ status: "approved", decidedAt: new Date(), argsHash: "0".repeat(64) }).where(where))).rejects.toThrow();
    await expect(as("member-a", (tx) => tx.update(aiToolApprovals).set({ status: "consumed", consumedAt: new Date() }).where(where))).rejects.toThrow();
    await expect(as("member-a", (tx) => tx.insert(aiToolApprovals).values({ tenantId: tenantA, tool: "crm_create_task", argsHash: "0".repeat(64), requestedBy: "member-b", expiresAt: sql`now() + interval '5 minutes'` }))).rejects.toThrow();
    await expect(as("member-a", (tx) => tx.insert(aiToolApprovals).values({ tenantId: tenantA, tool: "crm_create_task", argsHash: "0".repeat(64), requestedBy: "member-a", status: "approved", expiresAt: sql`now() + interval '5 minutes'` }))).rejects.toThrow();
    await expect(as("member-a", (tx) => tx.delete(aiToolApprovals).where(where))).rejects.toThrow();
    // Consumed is final.
    await decideToolApproval(fixture.db, "member-a", tenantA, approvalId, "approve");
    await executeCrmTool(fixture.db, "member-a", tenantA, "crm_create_task", taskArgs, { approvalId });
    await expect(as("member-a", (tx) => tx.update(aiToolApprovals).set({ status: "approved" }).where(where))).rejects.toThrow();
    // Without a tenant context nothing is visible.
    expect(await fixture.db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.tenant_id', '', true)`); return tx.select().from(aiToolApprovals); })).toEqual([]);
  });
});
