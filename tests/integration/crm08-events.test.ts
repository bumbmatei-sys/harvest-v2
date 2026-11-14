import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, linkCompany, patchContact, recordConsent, unlinkCompany, getContact } from "../../src/server/contacts";
import { createCompany, patchCompany } from "../../src/server/companies";
import { createDeal, listPipelines, moveDeal, updateDeal } from "../../src/server/crm-deals";
import { createNote, createTask } from "../../src/server/crm-tasks";
import { recordAssociation } from "../../src/server/crm-associations";
import { crmEventContracts, crmEventTypes, emitCrmEvent } from "../../src/server/crm-events";
import { buildJobHandlers, type CrmEventSubscriber } from "../../src/server/jobs/handlers";
import { claimJob, flushOutbox, runClaimedJob } from "../../src/server/jobs/service";
import { withTenant } from "../../src/server/tenancy";

let fixture: Awaited<ReturnType<typeof testDatabase>>, tenantA: string, tenantB: string;
const events = async (tenant: string) => (await fixture.admin.query("select id, kind, payload, created_at from outbox_events where tenant_id = $1 and kind like 'crm.%' order by created_at, id", [tenant])).rows as
  { id: string; kind: string; payload: Record<string, unknown>; created_at: Date }[];
const consent = { channel: "email", status: "granted", purpose: "messaging", noticeVersion: "notice-v1", source: "Synthetic signup form at SECRET-SOURCE", evidence: "SECRET-EVIDENCE screenshot" } as const;

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "member-a", "viewer-a", "owner-b"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "CRM-08 events A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "CRM-08 events B")).tenantId;
  await putMember(fixture.db, "owner-a", tenantA, "member-a@example.test", "member");
  await putMember(fixture.db, "owner-a", tenantA, "viewer-a@example.test", "viewer");
});
afterAll(async () => { await fixture?.close(); });

describe("CRM lifecycle events (contracts and emission)", () => {
  it("emits one typed event per People, Organization, deal, task, note and activity write, with ids and field names only", async () => {
    const before = (await events(tenantA)).length;
    const org = await createCompany(fixture.db, "member-a", tenantA, { name: "Synthetic SECRET-ORG Trust", domain: "secret-org.example", description: "SECRET-DESCRIPTION text" });
    const person = await createContact(fixture.db, "member-a", tenantA, { name: "Synthetic SECRET-NAME", email: "secret.person@example.test", phone: "+4915100000001", notes: "SECRET-NOTES private" });
    const patched = await patchContact(fixture.db, "member-a", tenantA, person.id, { version: person.version, notes: "SECRET-NOTES changed", phone: "+4915100000002" });
    await recordConsent(fixture.db, "owner-a", tenantA, person.id, consent);
    await linkCompany(fixture.db, "member-a", tenantA, person.id, { companyId: org.id, title: "SECRET-TITLE lead" });
    const updatedOrg = await patchCompany(fixture.db, "member-a", tenantA, org.id, { version: org.version, description: "SECRET-DESCRIPTION two" });
    void updatedOrg;
    const deal = await createDeal(fixture.db, "member-a", tenantA, { name: "SECRET-DEAL renewal", amount: "12345.67", contactId: person.id, companyId: org.id });
    const pipelines = await listPipelines(fixture.db, "member-a", tenantA);
    const won = pipelines[0].stages.find((stage) => stage.kind === "won")!;
    const moved = await moveDeal(fixture.db, "member-a", tenantA, deal.id, { stageId: won.id, version: deal.version, closedReason: "SECRET-REASON budget" });
    await updateDeal(fixture.db, "member-a", tenantA, deal.id, { version: moved.version, amount: "999.00" });
    await createTask(fixture.db, "member-a", tenantA, { title: "Synthetic follow-up", body: "SECRET-TASK-BODY", contactId: person.id });
    await createNote(fixture.db, "member-a", tenantA, { target: "person", targetId: person.id, body: "SECRET-NOTE-BODY" });
    await recordAssociation(fixture.db, "member-a", tenantA, { source: "form", kind: "form_submission", purpose: "messaging", contactId: person.id, summary: "SECRET-SUMMARY text", payload: { raw: "SECRET-PAYLOAD" } });
    await unlinkCompany(fixture.db, "member-a", tenantA, person.id, org.id);
    void patched;
    const emitted = (await events(tenantA)).slice(before);
    expect(emitted.map((row) => row.kind)).toEqual([
      "crm.organization.created", "crm.person.created", "crm.person.updated", "crm.person.consent_recorded", "crm.person.organization_linked", "crm.organization.updated",
      "crm.deal.created", "crm.deal.stage_changed", "crm.deal.updated", "crm.task.created", "crm.note.created", "crm.association.recorded", "crm.person.organization_unlinked"]);
    // Every payload satisfies its contract exactly.
    for (const row of emitted) expect(crmEventContracts[row.kind as keyof typeof crmEventContracts].data.safeParse(row.payload).success, row.kind).toBe(true);
    expect(emitted.find((row) => row.kind === "crm.person.updated")!.payload).toMatchObject({ contactId: person.id, fields: ["notes", "phone"] });
    expect(emitted.find((row) => row.kind === "crm.person.consent_recorded")!.payload).toMatchObject({ purpose: "messaging", channel: "email", status: "granted" });
    expect(emitted.find((row) => row.kind === "crm.deal.stage_changed")!.payload).toMatchObject({ opportunityId: deal.id, toStageId: won.id, toStageKind: "won", contactId: person.id, companyId: org.id });
    // Sensitive content never leaves its table: no names, identifiers, notes, descriptions, amounts, reasons, bodies, consent evidence or activity content.
    const dump = JSON.stringify(emitted.map((row) => row.payload));
    for (const secret of ["SECRET", "secret.person@example.test", "+4915100000001", "+4915100000002", "secret-org.example", "12345.67", "999.00"]) expect(dump).not.toContain(secret);
  });

  it("writes nothing when the domain write fails, and nothing of the write when the event fails (one transaction)", async () => {
    const before = (await events(tenantA)).length, people = async () => Number((await fixture.admin.query("select count(*) from contacts where tenant_id = $1", [tenantA])).rows[0].count);
    const count = await people();
    // A stale inline edit fails: no event.
    const person = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Atomic" });
    await expect(patchContact(fixture.db, "owner-a", tenantA, person.id, { version: person.version + 5, name: "Other" })).rejects.toMatchObject({ status: 409 });
    expect((await events(tenantA)).length).toBe(before + 1);
    // An outbox insert that fails rolls the person back too.
    await fixture.admin.query(`create function test_fail_outbox() returns trigger language plpgsql as $$ begin raise exception 'outbox down'; end $$;
      create trigger test_fail_outbox before insert on outbox_events for each row when (new.kind = 'crm.person.created') execute function test_fail_outbox()`);
    try { await expect(createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Never Saved" })).rejects.toThrow(); }
    finally { await fixture.admin.query("drop trigger test_fail_outbox on outbox_events; drop function test_fail_outbox()"); }
    expect(await people()).toBe(count + 1);
    expect((await events(tenantA)).length).toBe(before + 1);
  });

  it("rejects payloads outside the contract and keeps a repeated key to one event", async () => {
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx, tenantId) =>
      emitCrmEvent(tx, tenantId, "crm.person.created", "test:extra", { tenantId, actorId: "owner-a", contactId: null, name: "leak" } as never))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (_tx) =>
      emitCrmEvent(_tx, tenantA, "crm.person.created", "test:tenant", { tenantId: tenantB, actorId: "owner-a", contactId: null }))).rejects.toThrow();
    const emit = () => withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx, tenantId) => emitCrmEvent(tx, tenantId, "crm.organization.created", "test:same-key", { tenantId, actorId: "owner-a", companyId: "00000000-0000-4000-8000-0000000000aa" }));
    const [first, second] = [await emit(), await emit()];
    expect(second.id).toBe(first.id);
    expect((await fixture.admin.query("select count(*)::int as n from outbox_events where tenant_id = $1 and idempotency_key = 'test:same-key'", [tenantA])).rows[0].n).toBe(1);
  });

  it("keeps every contract strict, versioned and free of personal-data keys", () => {
    for (const type of crmEventTypes) {
      const contract = crmEventContracts[type];
      expect(contract.version, type).toBe(1);
      const shape = (contract.data as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      for (const key of ["name", "email", "phone", "notes", "description", "amount", "closedReason", "evidence", "title", "body", "summary"]) {
        // body/summary appear only as { redacted: true, length } markers (tasks, notes, activities).
        if ((key === "body" || key === "summary") && shape[key]) { expect(JSON.stringify(Object.keys((shape[key] as { shape: object }).shape)), `${type}.${key}`).toBe('["redacted","length"]'); continue; }
        expect(Object.keys(shape), `${type}.${key}`).not.toContain(key);
      }
      // Consent events say which purpose, channel and status; never where or how it was recorded.
      if (type === "crm.person.consent_recorded") expect(Object.keys(shape)).not.toContain("source");
      expect(shape, type).toHaveProperty("tenantId");
    }
  });
});

describe("consumer boundary", () => {
  it("hands each subscriber a validated envelope whose id is the outbox event id, inside the job transaction", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 consumers")).tenantId;
    const person = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Consumer" });
    const [outbox] = (await events(tenant)).filter((row) => row.kind === "crm.person.created");
    const seen: unknown[] = [];
    const subscriber: CrmEventSubscriber = { name: "test", accepts: (type) => type.startsWith("crm.person."), handle: async (_tx, event) => { seen.push(event); } };
    await flushOutbox(fixture.db, "owner-a", tenant);
    const handlers = buildJobHandlers([subscriber]);
    for (let claim = await claimJob(fixture.db, "owner-a", tenant, "test"); claim; claim = await claimJob(fixture.db, "owner-a", tenant, "test")) {
      expect((await runClaimedJob(fixture.db, "owner-a", tenant, claim, handlers)).status).toBe("succeeded");
    }
    expect(seen).toEqual([{ id: outbox.id, type: "crm.person.created", version: 1, tenantId: tenant, occurredAt: new Date(outbox.created_at).toISOString(), data: { actorId: "owner-a", contactId: person.id } }]);
  });

  it("retries and finally dead-letters an event whose payload no longer matches its contract, without calling subscribers", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 invalid")).tenantId;
    await createCompany(fixture.db, "owner-a", tenant, { name: "Synthetic Invalid Org" });
    await flushOutbox(fixture.db, "owner-a", tenant);
    await fixture.admin.query("update jobs set payload = payload || '{\"name\":\"leak\"}', max_attempts = 2 where tenant_id = $1 and kind = 'crm.organization.created'", [tenant]);
    let calls = 0;
    const handlers = buildJobHandlers([{ name: "test", accepts: () => true, handle: async () => { calls++; } }]);
    const statuses: string[] = [];
    for (let i = 0; i < 2; i++) {
      await fixture.admin.query("update jobs set scheduled_for = now() where tenant_id = $1", [tenant]);
      const claim = await claimJob(fixture.db, "owner-a", tenant, "test");
      statuses.push((await runClaimedJob(fixture.db, "owner-a", tenant, claim!, handlers)).status);
    }
    expect(statuses).toEqual(["queued", "dead_letter"]);
    expect(calls).toBe(0);
    expect((await fixture.admin.query("select last_error from jobs where tenant_id = $1", [tenant])).rows[0].last_error).toBe("INVALID_JOB_PAYLOAD");
  });

  it("refuses CRM jobs that did not come from the outbox", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 forged")).tenantId;
    await fixture.admin.query(`insert into jobs (tenant_id, kind, idempotency_key, fingerprint, payload, max_attempts) values ($1, 'crm.person.created', 'forged:1', repeat('a', 64), $2, 1)`,
      [tenant, JSON.stringify({ tenantId: tenant, actorId: "owner-a", contactId: null })]);
    const claim = await claimJob(fixture.db, "owner-a", tenant, "test");
    expect((await runClaimedJob(fixture.db, "owner-a", tenant, claim!, buildJobHandlers([]))).status).toBe("dead_letter");
  });

  it("delivers an erased person's events with the id already removed", async () => {
    const person = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Erased" });
    const [created] = (await events(tenantA)).filter((row) => row.kind === "crm.person.created" && row.payload.contactId === person.id);
    await eraseContact(fixture.db, "owner-a", tenantA, person.id);
    expect((await fixture.admin.query("select payload from outbox_events where id = $1", [created.id])).rows[0].payload.contactId).toBeNull();
    await expect(getContact(fixture.db, "owner-a", tenantA, person.id)).rejects.toMatchObject({ status: 404 });
  });
});
