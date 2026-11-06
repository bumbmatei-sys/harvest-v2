import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { crmNotes, crmNotifications, crmTasks, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, linkCompany, patchContact } from "../../src/server/contacts";
import { createCompany } from "../../src/server/companies";
import { createDeal, listPipelines, moveDeal } from "../../src/server/crm-deals";
import { createNote, createTask, getTask, listNotifications, listRelatedTasks, listTasks, markNotificationsRead, updateNote, updateTask } from "../../src/server/crm-tasks";
import { getTimeline } from "../../src/server/activity";
import { appendOutboxEvent } from "../../src/server/jobs/outbox";
import { withTenant } from "../../src/server/tenancy";
import { taskQuery, zonedToInstant } from "../../src/lib/crm-tasks";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, personA: string, companyA: string, dealA: string, personB: string;
const query = (value: Record<string, unknown> = {}) => taskQuery.parse(value);
const later = (fn: () => unknown) => Promise.resolve().then(fn);
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const outbox = (key: string) => fixture.admin.query("select kind, payload from outbox_events where idempotency_key = $1", [key]).then((result) => result.rows);

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "member-a2", "viewer-a", "owner-b", "outsider"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Tasks A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Tasks B")).tenantId;
  for (const [email, role] of [["admin-a", "admin"], ["member-a", "member"], ["member-a2", "member"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${email}@example.test`, role);
  personA = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Priscilla" })).id;
  companyA = (await createCompany(fixture.db, "owner-a", tenantA, { name: "Corinth Tents" })).id;
  await listPipelines(fixture.db, "owner-a", tenantA);
  dealA = (await createDeal(fixture.db, "owner-a", tenantA, { name: "Tent order", companyId: companyA })).id;
  personB = (await createContact(fixture.db, "owner-b", tenantB, { name: "Synthetic Aquila" })).id;
});
afterAll(async () => { await fixture?.close(); });

describe("CRM-05 schema and RLS", () => {
  it("forces RLS on every new table and shows nothing without tenant context", async () => {
    const { rows } = await fixture.admin.query("select relname, relforcerowsecurity from pg_class where relname in ('crm_tasks','crm_notes','crm_notifications') order by relname");
    expect(rows.map((row) => [row.relname, row.relforcerowsecurity])).toEqual([["crm_notes", true], ["crm_notifications", true], ["crm_tasks", true]]);
    for (const table of [crmTasks, crmNotes, crmNotifications]) expect(await fixture.db.select().from(table)).toEqual([]);
  });
});

describe("tasks", () => {
  let taskId: string, version: number;
  it("creates a linked task, audits relation ids, notifies the assignee and appends a redacted outbox event in the same transaction", async () => {
    const created = await createTask(fixture.db, "owner-a", tenantA, { title: "Call about the tent order", body: "Sensitive pastoral detail", priority: "high", dueAt: hoursFromNow(48), assigneeUserId: "member-a", contactId: personA, opportunityId: dealA });
    taskId = created.id; version = created.version;
    const task = await getTask(fixture.db, "viewer-a", tenantA, taskId);
    expect(task).toMatchObject({ status: "open", priority: "high", assigneeName: "Synthetic member-a", contactName: "Synthetic Priscilla", dealName: "Tent order", completedAt: null });
    const [log] = (await fixture.admin.query("select metadata from audit_logs where target_id = $1 and action = 'task.create'", [taskId])).rows;
    expect(log.metadata).toEqual({ contactId: personA, opportunityId: dealA });
    const [event] = await outbox(`crm:task:${taskId}:created`);
    expect(event.kind).toBe("crm.task.created");
    expect(event.payload).toMatchObject({ taskId, assigneeId: "member-a", status: "open", body: { redacted: true, length: 25 } });
    expect(JSON.stringify(event.payload)).not.toContain("Sensitive");
    const notices = await listNotifications(fixture.db, "member-a", tenantA);
    expect(notices).toMatchObject({ unread: 1, items: [{ kind: "task_assigned", taskId, taskTitle: "Call about the tent order", actorName: "Synthetic owner-a" }] });
    expect((await listNotifications(fixture.db, "owner-a", tenantA)).unread).toBe(0);
  });
  it("refuses a conflicting outbox payload under the same key (409) and rolls the write back", async () => {
    await expect(withTenant(fixture.db, "owner-a", tenantA, "tasks:write", (tx, tenantId) => appendOutboxEvent(tx, tenantId, { kind: "crm.task.created", idempotencyKey: `crm:task:${taskId}:created`, payload: { taskId, forged: true } }))).rejects.toMatchObject({ status: 409 });
    // Replaying the identical payload is idempotent.
    const [event] = await outbox(`crm:task:${taskId}:created`);
    await expect(withTenant(fixture.db, "owner-a", tenantA, "tasks:write", (tx, tenantId) => appendOutboxEvent(tx, tenantId, { kind: "crm.task.created", idempotencyKey: `crm:task:${taskId}:created`, payload: event.payload }))).resolves.toBeDefined();
  });
  it("requires a workspace member as assignee, in the service and in SQL", async () => {
    await expect(createTask(fixture.db, "owner-a", tenantA, { title: "Outsider", assigneeUserId: "outsider" })).rejects.toMatchObject({ status: 400 });
    await expect(updateTask(fixture.db, "owner-a", tenantA, taskId, { assigneeUserId: "owner-b", version })).rejects.toMatchObject({ status: 400 });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "tasks:write", (tx) => tx.execute(sql`update crm_tasks set assignee_user_id = 'outsider' where id = ${taskId}::uuid`)))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining("assignee is not a member") } });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "tasks:write", (tx) => tx.execute(sql`update crm_tasks set status = 'done' where id = ${taskId}::uuid`))).rejects.toThrow();
  });
  it("edits with versions, completes, reopens and reassigns, each with its own audit action and outbox event", async () => {
    const edited = await updateTask(fixture.db, "member-a", tenantA, taskId, { title: "Call Priscilla about the tents", version });
    await expect(updateTask(fixture.db, "member-a", tenantA, taskId, { title: "Stale", version })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    const done = await updateTask(fixture.db, "member-a", tenantA, taskId, { status: "done", version: edited.version });
    expect((await getTask(fixture.db, "member-a", tenantA, taskId)).completedAt).not.toBeNull();
    expect((await outbox(`crm:task:${taskId}:v${done.version}:completed`))[0].kind).toBe("crm.task.completed");
    const reopened = await updateTask(fixture.db, "member-a", tenantA, taskId, { status: "open", version: done.version });
    expect((await getTask(fixture.db, "member-a", tenantA, taskId)).completedAt).toBeNull();
    const reassigned = await updateTask(fixture.db, "member-a", tenantA, taskId, { assigneeUserId: "member-a2", version: reopened.version });
    expect((await outbox(`crm:task:${taskId}:v${reassigned.version}:reassigned`))[0].payload).toMatchObject({ assigneeId: "member-a2", previousAssigneeId: "member-a" });
    expect((await listNotifications(fixture.db, "member-a2", tenantA)).items.map((item) => item.taskId)).toEqual([taskId]);
    const actions = (await fixture.admin.query("select action, metadata from audit_logs where target_id = $1 order by created_at, id", [taskId])).rows;
    expect(actions.map((row) => row.action)).toEqual(["task.create", "task.update", "task.complete", "task.reopen", "task.reassign"]);
    expect(actions[1].metadata).toEqual({ contactId: personA, opportunityId: dealA, fields: "title" });
    expect(actions[4].metadata).toMatchObject({ fromUserId: "member-a", toUserId: "member-a2" });
    version = reassigned.version;
  });
  it("denies viewers every task mutation", async () => {
    await expect(createTask(fixture.db, "viewer-a", tenantA, { title: "Denied" })).rejects.toMatchObject({ status: 403 });
    await expect(updateTask(fixture.db, "viewer-a", tenantA, taskId, { status: "done", version })).rejects.toMatchObject({ status: 403 });
  });
  it("filters by assignee (me by default), status, due bucket, link type and text", async () => {
    await createTask(fixture.db, "owner-a", tenantA, { title: "Overdue visit", assigneeUserId: "owner-a", dueAt: hoursFromNow(-30), companyId: companyA });
    await createTask(fixture.db, "owner-a", tenantA, { title: "Personal reminder", assigneeUserId: "owner-a" });
    await createTask(fixture.db, "owner-a", tenantA, { title: "Later follow-up", assigneeUserId: "owner-a", dueAt: hoursFromNow(24 * 10) });
    const mine = await listTasks(fixture.db, "owner-a", tenantA, query());
    expect(mine.tasks.map((task) => task.title)).toEqual(["Overdue visit", "Later follow-up", "Personal reminder"]);
    expect((await listTasks(fixture.db, "owner-a", tenantA, query({ due: "overdue" }))).tasks.map((task) => task.title)).toEqual(["Overdue visit"]);
    expect((await listTasks(fixture.db, "owner-a", tenantA, query({ due: "upcoming" }))).tasks.map((task) => task.title)).toEqual(["Later follow-up"]);
    expect((await listTasks(fixture.db, "owner-a", tenantA, query({ due: "none" }))).tasks.map((task) => task.title)).toEqual(["Personal reminder"]);
    expect((await listTasks(fixture.db, "owner-a", tenantA, query({ related: "none" }))).tasks.map((task) => task.title).sort()).toEqual(["Later follow-up", "Personal reminder"]);
    expect((await listTasks(fixture.db, "owner-a", tenantA, query({ assignee: "member-a2", q: "priscilla" }))).total).toBe(1);
    expect((await listTasks(fixture.db, "viewer-a", tenantA, query({ assignee: "any", related: "company" }))).tasks.map((task) => task.title)).toEqual(["Overdue visit"]);
    expect((await listTasks(fixture.db, "viewer-a", tenantA, query())).empty).toBe(false);
    await expect(listTasks(fixture.db, "owner-a", tenantA, query({ assignee: "outsider" }))).rejects.toMatchObject({ status: 400 });
    // "Today" uses the Berlin day: due later today counts; due at midnight tonight does not.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
    const tonight = zonedToInstant(`${today}T23:59`)!;
    if (tonight.getTime() > Date.now() + 60_000) {
      await createTask(fixture.db, "owner-a", tenantA, { title: "Due tonight", assigneeUserId: "owner-a", dueAt: tonight.toISOString() });
      expect((await listTasks(fixture.db, "owner-a", tenantA, query({ due: "today" }))).tasks.map((task) => task.title)).toEqual(["Due tonight"]);
    }
  });
  it("lists related tasks on person, company and deal records", async () => {
    expect((await listRelatedTasks(fixture.db, "viewer-a", tenantA, "person", personA)).tasks.map((task) => task.id)).toEqual([taskId]);
    expect((await listRelatedTasks(fixture.db, "viewer-a", tenantA, "deal", dealA)).tasks.map((task) => task.id)).toEqual([taskId]);
    expect((await listRelatedTasks(fixture.db, "viewer-a", tenantA, "company", companyA)).tasks.map((task) => task.title)).toEqual(["Overdue visit"]);
  });
  it("counts the caller's overdue tasks and marks notifications read, only their own", async () => {
    const owner = await listNotifications(fixture.db, "owner-a", tenantA);
    expect(owner.overdue).toBe(1);
    const mine = await listNotifications(fixture.db, "member-a", tenantA);
    // Another member cannot mark (or even see) them.
    expect(await markNotificationsRead(fixture.db, "member-a2", tenantA, mine.items.map((item) => item.id))).toEqual({ marked: 0 });
    await withTenant(fixture.db, "member-a2", tenantA, "tasks:read", async (tx) => {
      expect((await tx.select().from(crmNotifications)).every((row) => row.recipientUserId === "member-a2")).toBe(true);
    });
    expect(await markNotificationsRead(fixture.db, "member-a", tenantA, [mine.items[0].id])).toEqual({ marked: 1 });
    expect((await listNotifications(fixture.db, "member-a", tenantA)).unread).toBe(0);
    expect(await markNotificationsRead(fixture.db, "member-a2", tenantA, "all")).toEqual({ marked: 1 });
  });
});

describe("notes", () => {
  let noteId: string;
  it("creates notes on exactly one record, with redacted outbox events and author-only edits", async () => {
    const note = await createNote(fixture.db, "member-a", tenantA, { target: "person", targetId: personA, body: "Prefers  calls\nafter 5pm.  " });
    noteId = note.id;
    expect((await fixture.admin.query("select body from crm_notes where id = $1", [noteId])).rows[0].body).toBe("Prefers  calls\nafter 5pm.");
    const [event] = await outbox(`crm:note:${noteId}:created`);
    expect(event.payload).toMatchObject({ noteId, contactId: personA, body: { redacted: true, length: 25 } });
    expect(JSON.stringify(event.payload)).not.toContain("Prefers");
    await expect(updateNote(fixture.db, "member-a2", tenantA, noteId, { body: "Hijack", version: 1 })).rejects.toMatchObject({ status: 403 });
    const edited = await updateNote(fixture.db, "member-a", tenantA, noteId, { body: "Prefers calls after 5pm.", version: 1 });
    expect(edited.version).toBe(2);
    await expect(updateNote(fixture.db, "member-a", tenantA, noteId, { body: "Stale", version: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await updateNote(fixture.db, "admin-a", tenantA, noteId, { body: "Prefers calls after 5pm (checked).", version: 2 })).version).toBe(3);
  });
  it("rejects empty, oversized, foreign and multi-target notes, and viewers", async () => {
    await expect(later(() => createNote(fixture.db, "member-a", tenantA, { target: "person", targetId: personA, body: "   " }))).rejects.toMatchObject({ status: 400 });
    await expect(later(() => createNote(fixture.db, "member-a", tenantA, { target: "company", targetId: companyA, body: "x".repeat(10_001) }))).rejects.toMatchObject({ status: 400 });
    await expect(createNote(fixture.db, "member-a", tenantA, { target: "person", targetId: personB, body: "Foreign" })).rejects.toMatchObject({ status: 404 });
    await expect(createNote(fixture.db, "viewer-a", tenantA, { target: "person", targetId: personA, body: "Denied" })).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "notes:write", (tx, tenantId) => tx.insert(crmNotes).values({ tenantId, body: "Two targets", contactId: personA, companyId: companyA, createdBy: "owner-a" }))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "notes:write", (tx) => tx.update(crmNotes).set({ companyId: companyA, contactId: null }).where(eq(crmNotes.id, noteId)))).rejects.toThrow();
  });
});

describe("unified timeline", () => {
  it("merges ledger events and notes newest first for a person", async () => {
    const before = await getTimeline(fixture.db, "viewer-a", tenantA, "person", personA);
    await patchContact(fixture.db, "owner-a", tenantA, personA, { notes: "Updated", version: (await withTenant(fixture.db, "owner-a", tenantA, "contacts:read", (tx) => tx.execute(sql`select version from contacts where id = ${personA}::uuid`))).rows[0].version as number });
    const note = await createNote(fixture.db, "owner-a", tenantA, { target: "person", targetId: personA, body: "Newest note" });
    const { items } = await getTimeline(fixture.db, "viewer-a", tenantA, "person", personA);
    expect(items.length).toBe(before.items.length + 2);
    expect(items[0]).toMatchObject({ kind: "note", id: note.id, body: "Newest note" });
    expect(items[1]).toMatchObject({ kind: "event", action: "contact.update" });
    const actions = items.map((item) => (item.kind === "note" ? `note:${item.body.slice(0, 7)}` : item.action));
    expect(actions).toEqual(expect.arrayContaining(["task.create", "task.complete", "task.reopen", "task.reassign", "contact.create", "note:Prefers"]));
    // Strictly newest first.
    const times = items.map((item) => item.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const reassign = items.find((item) => item.kind === "event" && item.action === "task.reassign");
    expect(reassign).toMatchObject({ task: { title: "Call Priscilla about the tents" }, toUserName: "Synthetic member-a2" });
  });
  it("shows company link events, deal moves and their tasks on company and deal timelines", async () => {
    await linkCompany(fixture.db, "owner-a", tenantA, personA, { companyId: companyA });
    const companyItems = (await getTimeline(fixture.db, "viewer-a", tenantA, "company", companyA)).items;
    expect(companyItems.map((item) => (item.kind === "event" ? item.action : "note"))).toEqual(expect.arrayContaining(["contact.company_link", "task.create", "company.create"]));
    const [pipeline] = await listPipelines(fixture.db, "owner-a", tenantA);
    await moveDeal(fixture.db, "owner-a", tenantA, dealA, { stageId: pipeline.stages[1].id, version: 1 });
    const dealItems = (await getTimeline(fixture.db, "viewer-a", tenantA, "deal", dealA)).items;
    expect(dealItems[0]).toMatchObject({ kind: "event", action: "opportunity.move", fromStage: "New", toStage: "Contacted" });
    expect(dealItems.some((item) => item.kind === "event" && item.action === "task.complete")).toBe(true);
  });
  it("pages 50 items at a time with a stable cursor and no duplicates", async () => {
    const company = (await createCompany(fixture.db, "owner-a", tenantA, { name: "Paging Org" })).id;
    for (let index = 0; index < 54; index += 1) await createNote(fixture.db, "owner-a", tenantA, { target: "company", targetId: company, body: `Note ${index}` });
    const first = await getTimeline(fixture.db, "viewer-a", tenantA, "company", company);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await getTimeline(fixture.db, "viewer-a", tenantA, "company", company, first.nextCursor);
    expect(second.items.map((item) => (item.kind === "note" ? item.body : item.action))).toEqual(["Note 3", "Note 2", "Note 1", "Note 0", "company.create"]);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(55);
    await expect(later(() => getTimeline(fixture.db, "viewer-a", tenantA, "company", company, "garbage"))).rejects.toMatchObject({ status: 400 });
  });
  it("hides archived notes", async () => {
    const note = await createNote(fixture.db, "owner-a", tenantA, { target: "deal", targetId: dealA, body: "To archive" });
    await updateNote(fixture.db, "owner-a", tenantA, note.id, { archived: true, version: 1 });
    expect((await getTimeline(fixture.db, "viewer-a", tenantA, "deal", dealA)).items.some((item) => item.id === note.id)).toBe(false);
  });
});

describe("two-tenant isolation", () => {
  it("never exposes or accepts the other tenant's tasks, notes or timelines, in either direction", async () => {
    const taskB = await createTask(fixture.db, "owner-b", tenantB, { title: "B task", contactId: personB });
    const [taskA] = (await listTasks(fixture.db, "owner-a", tenantA, query({ assignee: "any" }))).tasks;
    await expect(getTask(fixture.db, "owner-a", tenantA, taskB.id)).rejects.toMatchObject({ status: 404 });
    await expect(getTask(fixture.db, "owner-b", tenantB, taskA.id)).rejects.toMatchObject({ status: 404 });
    await expect(getTask(fixture.db, "owner-a", tenantB, taskB.id)).rejects.toMatchObject({ status: 403 });
    await expect(updateTask(fixture.db, "owner-b", tenantB, taskA.id, { title: "Hijack", version: taskA.version })).rejects.toMatchObject({ status: 404 });
    await expect(createTask(fixture.db, "owner-b", tenantB, { title: "Cross", contactId: personA })).rejects.toMatchObject({ status: 404 });
    await expect(createNote(fixture.db, "owner-b", tenantB, { target: "deal", targetId: dealA, body: "Cross" })).rejects.toMatchObject({ status: 404 });
    await expect(getTimeline(fixture.db, "owner-b", tenantB, "person", personA)).rejects.toMatchObject({ status: 404 });
    await expect(getTimeline(fixture.db, "owner-a", tenantB, "person", personB)).rejects.toMatchObject({ status: 403 });
    await withTenant(fixture.db, "owner-b", tenantB, "tasks:read", async (tx) => {
      expect((await tx.select().from(crmTasks)).map((row) => row.id)).toEqual([taskB.id]);
      expect(await tx.select().from(crmNotes)).toEqual([]);
      expect(await tx.update(crmTasks).set({ title: "Hijack" }).where(eq(crmTasks.id, taskA.id)).returning()).toEqual([]);
    });
    await expect(withTenant(fixture.db, "owner-b", tenantB, "tasks:write", (tx, tenantId) => tx.insert(crmTasks).values({ tenantId, title: "FK", contactId: personA, createdBy: "owner-b" }))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-b", tenantB, "tasks:write", (tx) => tx.insert(crmTasks).values({ tenantId: tenantA, title: "RLS", createdBy: "owner-b" }))).rejects.toThrow();
  });
});

describe("erasure", () => {
  it("keeps tasks (unlinked, version bumped), deletes the person's notes and strips their id from task and note audit rows", async () => {
    const person = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Erased" });
    const task = await createTask(fixture.db, "owner-a", tenantA, { title: "Pray with them", contactId: person.id, companyId: companyA });
    await createNote(fixture.db, "owner-a", tenantA, { target: "person", targetId: person.id, body: "Private detail about the person" });
    await eraseContact(fixture.db, "owner-a", tenantA, person.id);
    expect(await getTask(fixture.db, "owner-a", tenantA, task.id)).toMatchObject({ contactId: null, version: 2, companyName: "Corinth Tents" });
    const dump = JSON.stringify((await fixture.admin.query("select * from crm_notes where tenant_id = $1", [tenantA])).rows)
      + JSON.stringify((await fixture.admin.query("select metadata from audit_logs where tenant_id = $1 and (action like 'task.%' or action like 'note.%')", [tenantA])).rows)
      + JSON.stringify((await fixture.admin.query("select * from crm_tasks where tenant_id = $1", [tenantA])).rows);
    expect(dump).not.toContain(person.id);
    expect(dump).not.toContain("Private detail about the person");
    // The task's history still shows on the company it is linked to.
    expect((await getTimeline(fixture.db, "owner-a", tenantA, "company", companyA)).items.some((item) => item.kind === "event" && item.task?.id === task.id)).toBe(true);
    await expect(getTimeline(fixture.db, "owner-a", tenantA, "person", person.id)).rejects.toMatchObject({ status: 404 });
  });
});
